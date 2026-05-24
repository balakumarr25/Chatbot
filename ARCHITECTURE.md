# Architecture Notes

## Ingestion Flow

```
User sends message
       │
       ▼
Chatbot UI (browser)
  POST /api/chat/stream  ──────────────────────────────────────────────────────┐
       │                                                                        │
       ▼                                                                        │
Chatbot Server (Node.js)                                                        │
  ┌─────────────────────────────────────────────────────────────────────┐      │
  │  LLM SDK Wrapper                                                    │      │
  │                                                                     │      │
  │  1. Record request_timestamp                                        │      │
  │  2. Call provider API (OpenAI / Anthropic / Google / DeepSeek / xAI)│      │
  │  3. Stream tokens back to browser via SSE                           │──────┘
  │  4. Record response_timestamp, token counts, TTFT                  │
  │  5. Fire-and-forget: POST /ingest/logs  ──────────────────────────►│
  └─────────────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
                                   Ingestion API (FastAPI)
                                   ┌──────────────────────────────────┐
                                   │  1. Validate (Pydantic)          │
                                   │  2. Redact PII (Presidio)        │
                                   │  3. Truncate previews            │
                                   │  4. Estimate cost                │
                                   │  5. Write to PostgreSQL          │
                                   │  6. Publish to Redis (bg task)   │
                                   └──────────────────────────────────┘
                                                │
                                    ┌───────────┴───────────┐
                                    ▼                       ▼
                               PostgreSQL               Redis
                               (durable store)          (real-time events)
                                    │                       │
                                    └───────────┬───────────┘
                                                ▼
                                           Worker Process
                                           ┌──────────────────────────┐
                                           │  - Consume event queue   │
                                           │  - Mark events processed │
                                           │  - Refresh hourly_metrics│
                                           │    every 5 minutes       │
                                           └──────────────────────────┘
```

## Logging Strategy

### What's Captured Per Inference Call

| Field | Source | Notes |
|---|---|---|
| `provider` / `model` | SDK config | Normalized to lowercase |
| `request_timestamp` | Before API call | UTC |
| `response_timestamp` | After last token | UTC |
| `latency_ms` | Computed | response - request |
| `time_to_first_token_ms` | First stream chunk | Streaming only |
| `prompt_tokens` | API response | Provider-specific field |
| `completion_tokens` | API response | Provider-specific field |
| `status` | success / error / cancelled | |
| `error_code` / `error_message` | Exception catch | HTTP status if available |
| `input_preview` | First 200 chars | PII-redacted |
| `output_preview` | First 200 chars | PII-redacted |
| `is_streaming` | SDK flag | |
| `stream_chunks` | Counter | Streaming only |
| `estimated_cost_usd` | Pricing table | Computed at ingestion |
| `session_id` | Browser UUID | Persisted in localStorage |
| `conversation_id` | Created on first message | UUID from DB |

### Why Fire-and-Forget?

The user's chat response must never be delayed by logging infrastructure. The SDK sends logs asynchronously after the response is complete. Retries (3x with backoff) handle transient failures. If the ingestion API is down, logs are lost — acceptable for an observability system where some data loss is preferable to degraded user experience.

For zero-loss requirements, the SDK could buffer logs locally and flush in batches, or write to a local SQLite file as a fallback.

## Scaling Considerations

### Current Architecture (Single Node)
- Handles ~100-500 req/min comfortably
- PostgreSQL connection pool: 10 connections + 20 overflow
- Redis: single instance, in-memory queue

### Path to Scale

**10K req/min:**
- Add 2-4 ingestion API replicas behind nginx/ALB
- Increase DB connection pool or add PgBouncer
- Redis Cluster for pub/sub

**100K req/min:**
- Replace Redis queue with Kafka (partitioned by session_id)
- Separate read/write DB paths (read replica for dashboard)
- Async batch writes to DB (buffer in Redis, flush every 100ms)
- PII redaction as separate microservice

**1M req/min:**
- ClickHouse or TimescaleDB for time-series metrics
- Kafka with multiple consumer groups
- Separate hot/cold storage (recent logs in Redis, archive in S3/Parquet)

## Failure Handling Assumptions

1. **Ingestion API unavailable**: SDK retries 3x, then drops the log. Chat continues unaffected.

2. **Redis unavailable**: Event publishing fails silently. The PostgreSQL `events` table provides durability — the worker can replay from there on restart.

3. **Database unavailable**: Ingestion API returns 500. SDK retries. If DB is down for extended period, logs are lost (acceptable tradeoff vs. adding a local buffer).

4. **Provider API error**: Captured as `status=error` with full error details. The conversation continues — the user sees the error in the UI.

5. **Stream cancelled by user**: The SSE connection closes, the generator stops, partial content is logged. The conversation is marked `cancelled` in the DB.

6. **Worker crash**: Docker restarts it. Unprocessed events remain in the `events` table (processed=false) and the Redis queue. On restart, the worker picks up where it left off.

7. **PII redaction failure**: Falls back to regex-based redaction. If that also fails, the raw text is stored (logged as a warning). The ingestion never fails due to PII redaction errors.

## Event-Based Architecture

Events are published to two places simultaneously:
- **Redis pub/sub** (`llm.events.<type>`) — for real-time consumers (e.g., alerting, live dashboard updates via WebSocket)
- **Redis list** (`llm.events.queue`) — for reliable async processing by the worker
- **PostgreSQL `events` table** — durable record, survives Redis restart

Event types:
- `conversation.created`
- `inference.completed`
- `inference.error`

This pattern allows adding new consumers (e.g., a Slack alerter, a cost monitor) without modifying the ingestion API.
