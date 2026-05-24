"""
Ingestion endpoints — receives logs from the SDK.
"""
import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from database import get_db
from models import Conversation, Message, InferenceLog, Event
from schemas import (
    InferenceLogIngest, MessageIngest,
    ConversationCreate, ConversationUpdate,
    ConversationOut, MessageOut, InferenceLogOut,
)
from pii_redactor import redact_text, truncate_preview
from cost_estimator import estimate_cost
from event_bus import publish_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ingest", tags=["ingestion"])


# ─── Conversations ────────────────────────────────────────────────────────────

@router.post("/conversations", response_model=ConversationOut, status_code=201)
async def create_conversation(
    body: ConversationCreate,
    db: AsyncSession = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    conv = Conversation(
        session_id=body.session_id,
        provider=body.provider,
        model=body.model,
        title=body.title,
        metadata_=body.metadata,
    )
    db.add(conv)
    await db.flush()
    await db.refresh(conv)

    # Persist event
    event = Event(
        event_type="conversation.created",
        payload={"conversation_id": str(conv.id), "session_id": body.session_id},
    )
    db.add(event)

    background_tasks.add_task(
        publish_event,
        "conversation.created",
        {"conversation_id": str(conv.id), "session_id": body.session_id},
    )

    return conv


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
async def update_conversation(
    conversation_id: UUID,
    body: ConversationUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Conversation).where(Conversation.id == conversation_id))
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if body.status is not None:
        conv.status = body.status
    if body.title is not None:
        conv.title = body.title

    await db.flush()
    await db.refresh(conv)
    return conv


# ─── Messages ─────────────────────────────────────────────────────────────────

@router.post("/messages", response_model=MessageOut, status_code=201)
async def ingest_message(
    body: MessageIngest,
    db: AsyncSession = Depends(get_db),
):
    # Redact PII
    redacted_content, was_redacted = redact_text(body.content)
    preview = truncate_preview(redacted_content)

    msg = Message(
        conversation_id=UUID(body.conversation_id),
        role=body.role,
        content=redacted_content,
        content_preview=preview,
        is_redacted=was_redacted,
        sequence_num=body.sequence_num,
    )
    db.add(msg)
    await db.flush()
    await db.refresh(msg)
    return msg


# ─── Inference Logs ───────────────────────────────────────────────────────────

@router.post("/logs", response_model=InferenceLogOut, status_code=201)
async def ingest_log(
    body: InferenceLogIngest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    # Redact + truncate previews
    input_preview = None
    output_preview = None

    if body.input_text:
        redacted_input, _ = redact_text(body.input_text)
        input_preview = truncate_preview(redacted_input)

    if body.output_text:
        redacted_output, _ = redact_text(body.output_text)
        output_preview = truncate_preview(redacted_output)

    # Compute latency if not provided
    latency_ms = body.latency_ms
    if latency_ms is None and body.response_timestamp:
        delta = body.response_timestamp - body.request_timestamp
        latency_ms = int(delta.total_seconds() * 1000)

    # Estimate cost
    cost = estimate_cost(
        body.provider,
        body.model,
        body.prompt_tokens,
        body.completion_tokens,
    )

    # Resolve conversation_id
    conv_id = UUID(body.conversation_id) if body.conversation_id else None

    log = InferenceLog(
        conversation_id=conv_id,
        provider=body.provider,
        model=body.model,
        request_timestamp=body.request_timestamp,
        response_timestamp=body.response_timestamp,
        latency_ms=latency_ms,
        prompt_tokens=body.prompt_tokens,
        completion_tokens=body.completion_tokens,
        total_tokens=body.total_tokens,
        status=body.status,
        error_code=body.error_code,
        error_message=body.error_message,
        http_status_code=body.http_status_code,
        input_preview=input_preview,
        output_preview=output_preview,
        is_streaming=body.is_streaming,
        stream_chunks=body.stream_chunks,
        time_to_first_token_ms=body.time_to_first_token_ms,
        estimated_cost_usd=cost,
        request_metadata=body.request_metadata,
        response_metadata=body.response_metadata,
    )
    db.add(log)

    # Persist event record
    event_type = "inference.completed" if body.status == "success" else "inference.error"
    event = Event(
        event_type=event_type,
        payload={
            "log_id": None,  # filled after flush
            "provider": body.provider,
            "model": body.model,
            "latency_ms": latency_ms,
            "status": body.status,
            "session_id": body.session_id,
        },
    )
    db.add(event)
    await db.flush()
    await db.refresh(log)

    # Publish to Redis (non-blocking)
    background_tasks.add_task(
        publish_event,
        event_type,
        {
            "log_id": str(log.id),
            "provider": body.provider,
            "model": body.model,
            "latency_ms": latency_ms,
            "status": body.status,
            "session_id": body.session_id,
        },
    )

    return log


# ─── Batch ingestion ──────────────────────────────────────────────────────────

@router.post("/logs/batch", status_code=202)
async def ingest_logs_batch(
    logs: list[InferenceLogIngest],
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Accept up to 100 logs in a single request."""
    if len(logs) > 100:
        raise HTTPException(status_code=400, detail="Max 100 logs per batch")

    created_ids = []
    for body in logs:
        input_preview = truncate_preview(redact_text(body.input_text)[0]) if body.input_text else None
        output_preview = truncate_preview(redact_text(body.output_text)[0]) if body.output_text else None

        latency_ms = body.latency_ms
        if latency_ms is None and body.response_timestamp:
            delta = body.response_timestamp - body.request_timestamp
            latency_ms = int(delta.total_seconds() * 1000)

        cost = estimate_cost(body.provider, body.model, body.prompt_tokens, body.completion_tokens)
        conv_id = UUID(body.conversation_id) if body.conversation_id else None

        log = InferenceLog(
            conversation_id=conv_id,
            provider=body.provider,
            model=body.model,
            request_timestamp=body.request_timestamp,
            response_timestamp=body.response_timestamp,
            latency_ms=latency_ms,
            prompt_tokens=body.prompt_tokens,
            completion_tokens=body.completion_tokens,
            total_tokens=body.total_tokens,
            status=body.status,
            error_code=body.error_code,
            error_message=body.error_message,
            input_preview=input_preview,
            output_preview=output_preview,
            is_streaming=body.is_streaming,
            stream_chunks=body.stream_chunks,
            time_to_first_token_ms=body.time_to_first_token_ms,
            estimated_cost_usd=cost,
            request_metadata=body.request_metadata,
            response_metadata=body.response_metadata,
        )
        db.add(log)
        await db.flush()
        created_ids.append(str(log.id))

    return {"accepted": len(created_ids), "ids": created_ids}
