# LLM Inference Logging & Ingestion System

A production-grade system for capturing, storing, and visualizing LLM inference metadata across multiple providers.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Browser                             │
│  ┌──────────────────────┐    ┌──────────────────────────────┐  │
│  │   Chatbot UI :3000   │    │   Dashboard UI :3001         │  │
│  │  (Vanilla JS + SSE)  │    │  (React + Recharts)          │  │
│  └──────────┬───────────┘    └──────────────┬───────────────┘  │
└─────────────┼────────────────────────────────┼─────────────────┘
              │ HTTP / SSE                      │ HTTP
              ▼                                 ▼
┌─────────────────────────┐    ┌────────────────────────────────┐
│  Chatbot Server :3000   │    │   Ingestion API :8000          │
│  (Node.js / Express)    │    │   (FastAPI / Python)           │
│                         │    │                                │
│  ┌───────────────────┐  │    │  POST /ingest/logs             │
│  │   LLM SDK         │  │    │  POST /ingest/messages         │
│  │  ┌─────────────┐  │  │    │  POST /ingest/conversations    │
│  │  │ OpenAI      │  │  │    │  GET  /metrics/summary         │
│  │  │ Anthropic   │  │──┼───►│  GET  /metrics/latency-*       │
│  │  │ Google      │  │  │    │  GET  /metrics/providers       │
│  │  │ DeepSeek    │  │  │    │  GET  /conversations/*         │
│  │  │ xAI / Grok  │  │  │    │                                │
│  │  └─────────────┘  │  │    │  PII Redaction (Presidio)      │
│  └───────────────────┘  │    │  Cost Estimation               │
└─────────────────────────┘    └──────────────┬─────────────────┘
                                              │
                               ┌──────────────┼──────────────┐
                               ▼              ▼              ▼
                    ┌──────────────┐  ┌──────────────┐  ┌──────────┐
                    │  PostgreSQL  │  │    Redis     │  │  Worker  │
                    │  :5432       │  │  :6379       │  │          │
                    │              │  │              │  │ Event    │
                    │  conversations│  │ Event queue  │  │ consumer │
                    │  messages    │  │ Pub/Sub      │  │ Metrics  │
                    │  inference_  │  │              │  │ refresh  │
                    │  logs        │  └──────────────┘  └──────────┘
                    │  events      │
                    │  hourly_     │
                    │  metrics     │
                    └──────────────┘
```

## Quick Start (Docker — one command)

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env and add at least one API key

# 2. Start everything
docker compose up --build

# Services:
# Chatbot:   http://localhost:3000
# Dashboard: http://localhost:3001
# API:       http://localhost:8000
# API Docs:  http://localhost:8000/docs
```

## Manual Setup

### Prerequisites
- Node.js 20+
- Python 3.11+
- PostgreSQL 16+
- Redis 7+

### Ingestion API

```bash
cd ingestion
pip install -r requirements.txt
# Apply schema
psql -U llmuser -d llmlogs -f init.sql
# Start
uvicorn main:app --reload --port 8000
```

### Chatbot Server

```bash
cd chatbot
npm install
npm run dev
# Runs on http://localhost:3000
```

### Dashboard

```bash
cd dashboard
npm install
npm run dev
# Runs on http://localhost:3001
```

## Environment Variables

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_API_KEY` | Google Gemini API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `XAI_API_KEY` | xAI / Grok API key |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |

At least one provider API key is required.

---

## Schema Design Decisions

### Why PostgreSQL?

Structured relational data with strong consistency requirements. The schema is normalized where it matters (conversations → messages → inference_logs) but uses JSONB for flexible metadata that varies by provider.

### Table Design

**`conversations`** — one per chat session. Tracks provider, model, status (active/cancelled/completed). Enables the "list/resume/cancel conversation" UI features.

**`messages`** — individual chat turns. Stores full content (PII-redacted) plus a 200-char preview. Indexed with pg_trgm for full-text search. `sequence_num` preserves ordering without relying on timestamp precision.

**`inference_logs`** — one row per LLM API call. Captures everything the SDK measures: latency, token counts, streaming metadata, cost estimates, error details. Linked to conversations and messages via nullable FKs (SET NULL on delete so logs survive conversation deletion).

**`events`** — append-only event log for the event-based architecture. Processed by the worker asynchronously. Provides durability for Redis pub/sub (which is fire-and-forget).

**`hourly_metrics`** — materialized view refreshed every 5 minutes by the worker. Avoids expensive aggregation queries on the dashboard's hot path. Uses `CONCURRENTLY` refresh to avoid locking.

### Tradeoffs

| Decision | Tradeoff |
|---|---|
| JSONB for `request_metadata` / `response_metadata` | Flexible for provider-specific fields, but not indexed by default |
| Materialized view for metrics | Fast reads, 5-min staleness acceptable for dashboards |
| PII redaction at ingestion time | Adds ~10-50ms latency; data is clean at rest |
| Fire-and-forget SDK logging | Never blocks the user's chat response; risk of losing logs on crash (mitigated by retry logic) |
| Cost estimation in-process | Avoids external calls; pricing table needs manual updates |
| Redis + PostgreSQL events | Redis for real-time delivery, Postgres for durability |

---

## Ingestion Flow

```
SDK captures metadata
  → POST /ingest/logs (async, non-blocking to user)
    → Validate payload (Pydantic)
    → Redact PII (Presidio / regex fallback)
    → Truncate previews to 200 chars
    → Estimate cost
    → Write to inference_logs + events tables
    → Publish to Redis pub/sub (background task)
    → Return 201 with log ID

Worker (separate process):
  → Consumes Redis queue
  → Marks events as processed in DB
  → Refreshes hourly_metrics every 5 min
```

## Logging Strategy

The SDK wraps every LLM call with:
1. **Pre-call**: record `request_timestamp`, capture input text
2. **Post-call**: record `response_timestamp`, extract token usage, compute latency
3. **Error handling**: capture error code, message, HTTP status
4. **Streaming**: track time-to-first-token, chunk count, accumulate full response
5. **Fire-and-forget**: log is sent to ingestion API without blocking the response

Logs are sent with up to 3 retries with exponential backoff. Failures are logged to stderr but never surface to the user.

## Scaling Considerations

- **Ingestion API**: stateless FastAPI with async SQLAlchemy — scales horizontally behind a load balancer. `--workers 2` in Docker, increase for production.
- **Database**: connection pooling (pool_size=10, max_overflow=20). For high volume, add read replicas for dashboard queries.
- **Redis**: single instance sufficient for <10K req/min. For higher throughput, use Redis Cluster or replace with Kafka.
- **Materialized view**: refresh interval tunable. For real-time dashboards, switch to streaming aggregation.
- **Batch ingestion**: `/ingest/logs/batch` endpoint accepts up to 100 logs per request for high-throughput scenarios.
- **PII redaction**: Presidio is CPU-bound. For high volume, run as a separate microservice or use async worker pool.

## Failure Handling

| Failure | Handling |
|---|---|
| Ingestion API down | SDK retries 3x with backoff; logs stderr; chat continues |
| Redis down | Event publishing fails silently; DB events table provides durability |
| Provider API error | Captured as `status=error` log; error details stored |
| Stream cancelled | Partial content logged; conversation marked cancelled |
| DB connection lost | SQLAlchemy pool_pre_ping reconnects automatically |
| Worker crash | Restarts via Docker `restart: unless-stopped`; unprocessed events remain in DB |

---

## What I'd Improve With More Time

1. **Authentication** — API key auth on the ingestion endpoint; user accounts for the chatbot
2. **Kafka instead of Redis** — for guaranteed delivery, replay, and consumer groups at scale
3. **Prometheus + Grafana** — replace custom dashboard with battle-tested observability stack (metrics endpoint already exposed at `/metrics/prometheus`)
4. **Alembic migrations** — proper schema versioning instead of raw init.sql
5. **Rate limiting** — per-session and per-IP limits on the chatbot API
6. **Conversation search** — full-text search across message history using the pg_trgm index
7. **Cost alerts** — webhook/email when spend exceeds threshold
8. **Kubernetes manifests** — Helm chart for production deployment
9. **Test suite** — unit tests for SDK, integration tests for ingestion pipeline
10. **Token streaming metrics** — tokens/second calculation for streaming responses

---

## Bonus Features Implemented

- ✅ **Multi-provider support** — OpenAI, Anthropic, Google, DeepSeek, xAI
- ✅ **Streaming responses** — SSE streaming with time-to-first-token tracking
- ✅ **Latency + Throughput + Error dashboards** — real-time charts with time range selector
- ✅ **Docker Compose one-command setup** — `docker compose up --build`
- ✅ **Event-based architecture** — Redis pub/sub + PostgreSQL events table
- ✅ **PII redaction** — Microsoft Presidio with regex fallback
- ✅ **Frontend features** — cancel conversation, list conversations, resume conversation
