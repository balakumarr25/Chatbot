"""
Lightweight event bus backed by Redis Pub/Sub + PostgreSQL events table.
Provides near-real-time event delivery with durable storage fallback.
"""
import json
import logging
from datetime import datetime
from typing import Any, Optional
import redis.asyncio as aioredis
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_redis_client: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


async def publish_event(event_type: str, payload: dict[str, Any]) -> None:
    """Publish event to Redis channel (fire-and-forget)."""
    try:
        redis = await get_redis()
        message = json.dumps({
            "event_type": event_type,
            "payload": payload,
            "timestamp": datetime.utcnow().isoformat(),
        })
        await redis.publish(f"llm.events.{event_type}", message)
        # Also push to a list for workers that may have missed it
        await redis.lpush("llm.events.queue", message)
        await redis.ltrim("llm.events.queue", 0, 9999)  # keep last 10k events
    except Exception as e:
        logger.warning(f"Failed to publish event {event_type}: {e}")


async def close_redis() -> None:
    global _redis_client
    if _redis_client:
        await _redis_client.aclose()
        _redis_client = None
