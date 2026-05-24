-- LLM Inference Logging Schema
-- Designed for practical tradeoffs: normalized where it matters, JSONB for flexibility

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for text search

-- ─────────────────────────────────────────────
-- Conversations
-- ─────────────────────────────────────────────
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      TEXT NOT NULL,
    title           TEXT,
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',  -- active | cancelled | completed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata        JSONB DEFAULT '{}'
);

CREATE INDEX idx_conversations_session_id ON conversations(session_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_created_at ON conversations(created_at DESC);

-- ─────────────────────────────────────────────
-- Chat Messages
-- ─────────────────────────────────────────────
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,  -- user | assistant | system
    content         TEXT NOT NULL,
    content_preview TEXT,           -- first 200 chars, pre-computed
    is_redacted     BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sequence_num    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
-- Full-text search on message content
CREATE INDEX idx_messages_content_trgm ON messages USING gin(content gin_trgm_ops);

-- ─────────────────────────────────────────────
-- Inference Logs (one per LLM API call)
-- ─────────────────────────────────────────────
CREATE TABLE inference_logs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id     UUID REFERENCES conversations(id) ON DELETE SET NULL,
    message_id          UUID REFERENCES messages(id) ON DELETE SET NULL,
    
    -- Provider / Model
    provider            TEXT NOT NULL,
    model               TEXT NOT NULL,
    
    -- Timing
    request_timestamp   TIMESTAMPTZ NOT NULL,
    response_timestamp  TIMESTAMPTZ,
    latency_ms          INTEGER,        -- computed: response - request
    
    -- Token Usage
    prompt_tokens       INTEGER,
    completion_tokens   INTEGER,
    total_tokens        INTEGER,
    
    -- Status
    status              TEXT NOT NULL DEFAULT 'success',  -- success | error | cancelled | timeout
    error_code          TEXT,
    error_message       TEXT,
    http_status_code    INTEGER,
    
    -- Previews (truncated, PII-redacted)
    input_preview       TEXT,   -- first 200 chars of prompt
    output_preview      TEXT,   -- first 200 chars of completion
    
    -- Streaming
    is_streaming        BOOLEAN DEFAULT FALSE,
    stream_chunks       INTEGER,
    time_to_first_token_ms INTEGER,
    
    -- Cost estimation (USD)
    estimated_cost_usd  NUMERIC(10, 8),
    
    -- Raw metadata (flexible)
    request_metadata    JSONB DEFAULT '{}',
    response_metadata   JSONB DEFAULT '{}',
    
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inference_logs_conversation_id ON inference_logs(conversation_id);
CREATE INDEX idx_inference_logs_provider ON inference_logs(provider);
CREATE INDEX idx_inference_logs_model ON inference_logs(model);
CREATE INDEX idx_inference_logs_status ON inference_logs(status);
CREATE INDEX idx_inference_logs_request_timestamp ON inference_logs(request_timestamp DESC);
CREATE INDEX idx_inference_logs_latency ON inference_logs(latency_ms);

-- ─────────────────────────────────────────────
-- Events (event-based architecture)
-- ─────────────────────────────────────────────
CREATE TABLE events (
    id              BIGSERIAL PRIMARY KEY,
    event_type      TEXT NOT NULL,  -- inference.completed | inference.error | conversation.created | etc.
    payload         JSONB NOT NULL,
    processed       BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_event_type ON events(event_type);
CREATE INDEX idx_events_processed ON events(processed) WHERE processed = FALSE;
CREATE INDEX idx_events_created_at ON events(created_at DESC);

-- ─────────────────────────────────────────────
-- Materialized view for dashboard metrics
-- ─────────────────────────────────────────────
CREATE MATERIALIZED VIEW hourly_metrics AS
SELECT
    date_trunc('hour', request_timestamp) AS hour,
    provider,
    model,
    COUNT(*)                              AS total_requests,
    COUNT(*) FILTER (WHERE status = 'success') AS successful_requests,
    COUNT(*) FILTER (WHERE status = 'error')   AS failed_requests,
    AVG(latency_ms)                       AS avg_latency_ms,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99_latency_ms,
    SUM(total_tokens)                     AS total_tokens,
    SUM(estimated_cost_usd)               AS total_cost_usd
FROM inference_logs
GROUP BY 1, 2, 3
WITH DATA;

CREATE UNIQUE INDEX idx_hourly_metrics_unique ON hourly_metrics(hour, provider, model);

-- Refresh function (called by worker)
CREATE OR REPLACE FUNCTION refresh_hourly_metrics()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY hourly_metrics;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- Auto-update updated_at trigger
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
