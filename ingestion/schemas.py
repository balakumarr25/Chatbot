from pydantic import BaseModel, Field, field_validator
from typing import Optional, Any
from datetime import datetime
from uuid import UUID


# ─── Inbound (from SDK) ───────────────────────────────────────────────────────

class InferenceLogIngest(BaseModel):
    """Payload sent by the SDK to the ingestion endpoint."""
    conversation_id: Optional[str] = None
    session_id: str
    provider: str
    model: str
    request_timestamp: datetime
    response_timestamp: Optional[datetime] = None
    latency_ms: Optional[int] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    status: str = "success"
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    http_status_code: Optional[int] = None
    input_text: Optional[str] = None       # full input, will be truncated + redacted
    output_text: Optional[str] = None      # full output, will be truncated + redacted
    is_streaming: bool = False
    stream_chunks: Optional[int] = None
    time_to_first_token_ms: Optional[int] = None
    request_metadata: dict = Field(default_factory=dict)
    response_metadata: dict = Field(default_factory=dict)

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        allowed = {"success", "error", "cancelled", "timeout"}
        if v not in allowed:
            raise ValueError(f"status must be one of {allowed}")
        return v


class MessageIngest(BaseModel):
    conversation_id: str
    role: str
    content: str
    sequence_num: int = 0

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        allowed = {"user", "assistant", "system"}
        if v not in allowed:
            raise ValueError(f"role must be one of {allowed}")
        return v


class ConversationCreate(BaseModel):
    session_id: str
    provider: str
    model: str
    title: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


class ConversationUpdate(BaseModel):
    status: Optional[str] = None
    title: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            allowed = {"active", "cancelled", "completed"}
            if v not in allowed:
                raise ValueError(f"status must be one of {allowed}")
        return v


# ─── Outbound (API responses) ─────────────────────────────────────────────────

class ConversationOut(BaseModel):
    id: UUID
    session_id: str
    title: Optional[str]
    provider: str
    model: str
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageOut(BaseModel):
    id: UUID
    conversation_id: UUID
    role: str
    content: str
    content_preview: Optional[str]
    is_redacted: bool
    created_at: datetime
    sequence_num: int

    model_config = {"from_attributes": True}


class InferenceLogOut(BaseModel):
    id: UUID
    conversation_id: Optional[UUID]
    provider: str
    model: str
    request_timestamp: datetime
    response_timestamp: Optional[datetime]
    latency_ms: Optional[int]
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]
    total_tokens: Optional[int]
    status: str
    error_code: Optional[str]
    error_message: Optional[str]
    input_preview: Optional[str]
    output_preview: Optional[str]
    is_streaming: bool
    time_to_first_token_ms: Optional[int]
    estimated_cost_usd: Optional[float]
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Dashboard / Metrics ──────────────────────────────────────────────────────

class MetricsSummary(BaseModel):
    total_requests: int
    successful_requests: int
    failed_requests: int
    avg_latency_ms: Optional[float]
    p50_latency_ms: Optional[float]
    p95_latency_ms: Optional[float]
    p99_latency_ms: Optional[float]
    total_tokens: Optional[int]
    total_cost_usd: Optional[float]
    error_rate: Optional[float]


class TimeSeriesPoint(BaseModel):
    timestamp: datetime
    value: float
    label: Optional[str] = None


class ProviderBreakdown(BaseModel):
    provider: str
    model: str
    request_count: int
    avg_latency_ms: Optional[float]
    error_rate: Optional[float]
    total_tokens: Optional[int]
    total_cost_usd: Optional[float]
