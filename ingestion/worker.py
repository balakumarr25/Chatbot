"""
Background worker: processes events from Redis queue,
refreshes materialized views, handles retries.
"""
import asyncio
import json
import logging
import signal
from datetime import datetime

import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text

from config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("worker")

settings = get_settings()
engine = create_async_engine(settings.database_url, pool_size=5)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

RUNNING = True
METRICS_REFRESH_INTERVAL = 300  # 5 minutes


def handle_signal(sig, frame):
    global RUNNING
    logger.info(f"Received signal {sig}, shutting down worker")
    RUNNING = False


async def process_event(event_data: str) -> None:
    try:
        event = json.loads(event_data)
        event_type = event.get("event_type", "unknown")
        logger.info(f"Processing event: {event_type}")

        async with AsyncSessionLocal() as db:
            # Mark event as processed in DB
            await db.execute(
                text("""
                    UPDATE events
                    SET processed = TRUE
                    WHERE event_type = :event_type
                      AND processed = FALSE
                      AND created_at > NOW() - INTERVAL '1 minute'
                    LIMIT 10
                """),
                {"event_type": event_type},
            )
            await db.commit()
    except Exception as e:
        logger.error(f"Failed to process event: {e}")


async def refresh_metrics_loop() -> None:
    """Periodically refresh the hourly_metrics materialized view."""
    while RUNNING:
        try:
            async with AsyncSessionLocal() as db:
                await db.execute(text("SELECT refresh_hourly_metrics()"))
                await db.commit()
            logger.info("Refreshed hourly_metrics materialized view")
        except Exception as e:
            logger.error(f"Failed to refresh metrics: {e}")
        await asyncio.sleep(METRICS_REFRESH_INTERVAL)


async def event_consumer_loop() -> None:
    """Consume events from Redis queue."""
    redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    logger.info("Worker started, consuming from llm.events.queue")

    while RUNNING:
        try:
            # BRPOP with 2s timeout so we can check RUNNING flag
            result = await redis.brpop("llm.events.queue", timeout=2)
            if result:
                _, event_data = result
                await process_event(event_data)
        except Exception as e:
            logger.error(f"Redis consumer error: {e}")
            await asyncio.sleep(5)

    await redis.aclose()
    logger.info("Worker stopped")


async def main():
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    await asyncio.gather(
        event_consumer_loop(),
        refresh_metrics_loop(),
    )
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
