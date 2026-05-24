"""
Conversation query endpoints for the chatbot frontend.
"""
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from sqlalchemy.orm import selectinload

from database import get_db
from models import Conversation, Message, InferenceLog
from schemas import ConversationOut, MessageOut, InferenceLogOut

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    session_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    q = select(Conversation).order_by(desc(Conversation.updated_at))
    if session_id:
        q = q.where(Conversation.session_id == session_id)
    if status:
        q = q.where(Conversation.status == status)
    q = q.limit(limit).offset(offset)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/{conversation_id}", response_model=ConversationOut)
async def get_conversation(conversation_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Conversation).where(Conversation.id == conversation_id))
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
async def get_messages(
    conversation_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.sequence_num, Message.created_at)
    )
    return result.scalars().all()


@router.get("/{conversation_id}/logs", response_model=list[InferenceLogOut])
async def get_conversation_logs(
    conversation_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(InferenceLog)
        .where(InferenceLog.conversation_id == conversation_id)
        .order_by(desc(InferenceLog.request_timestamp))
    )
    return result.scalars().all()
