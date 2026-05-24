"""
Metrics and dashboard endpoints.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text, desc
from sqlalchemy.dialects.postgresql import insert

from database import get_db
from models import InferenceLog, Conversation
from schemas import MetricsSummary, TimeSeriesPoint, ProviderBreakdown

router = APIRouter(prefix="/metrics", tags=["metrics"])


def _default_since() -> datetime:
    return datetime.utcnow() - timedelta(hours=24)


@router.get("/summary", response_model=MetricsSummary)
async def get_summary(
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    provider: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    since = since or _default_since()
    until = until or datetime.utcnow()

    q = select(
        func.count().label("total"),
        func.count().filter(InferenceLog.status == "success").label("success"),
        func.count().filter(InferenceLog.status == "error").label("errors"),
        func.avg(InferenceLog.latency_ms).label("avg_latency"),
        func.percentile_cont(0.5).within_group(InferenceLog.latency_ms).label("p50"),
        func.percentile_cont(0.95).within_group(InferenceLog.latency_ms).label("p95"),
        func.percentile_cont(0.99).within_group(InferenceLog.latency_ms).label("p99"),
        func.sum(InferenceLog.total_tokens).label("total_tokens"),
        func.sum(InferenceLog.estimated_cost_usd).label("total_cost"),
    ).where(
        InferenceLog.request_timestamp >= since,
        InferenceLog.request_timestamp <= until,
    )

    if provider:
        q = q.where(InferenceLog.provider == provider)

    row = (await db.execute(q)).one()

    total = row.total or 0
    errors = row.errors or 0
    error_rate = (errors / total * 100) if total > 0 else 0.0

    return MetricsSummary(
        total_requests=total,
        successful_requests=row.success or 0,
        failed_requests=errors,
        avg_latency_ms=float(row.avg_latency) if row.avg_latency else None,
        p50_latency_ms=float(row.p50) if row.p50 else None,
        p95_latency_ms=float(row.p95) if row.p95 else None,
        p99_latency_ms=float(row.p99) if row.p99 else None,
        total_tokens=int(row.total_tokens) if row.total_tokens else None,
        total_cost_usd=float(row.total_cost) if row.total_cost else None,
        error_rate=error_rate,
    )


@router.get("/latency-timeseries", response_model=list[TimeSeriesPoint])
async def get_latency_timeseries(
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    interval: str = Query("1 hour"),
    provider: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    since = since or _default_since()
    until = until or datetime.utcnow()

    # Validate interval to prevent injection
    allowed_intervals = {"5 minutes", "15 minutes", "1 hour", "6 hours", "1 day"}
    if interval not in allowed_intervals:
        interval = "1 hour"

    q = text("""
        SELECT
            date_trunc(:interval_unit, request_timestamp) AS ts,
            AVG(latency_ms) AS avg_latency
        FROM inference_logs
        WHERE request_timestamp BETWEEN :since AND :until
          AND (:provider IS NULL OR provider = :provider)
        GROUP BY 1
        ORDER BY 1
    """)

    # Map interval string to trunc unit
    interval_map = {
        "5 minutes": "minute",
        "15 minutes": "minute",
        "1 hour": "hour",
        "6 hours": "hour",
        "1 day": "day",
    }

    rows = (await db.execute(q, {
        "interval_unit": interval_map.get(interval, "hour"),
        "since": since,
        "until": until,
        "provider": provider,
    })).fetchall()

    return [TimeSeriesPoint(timestamp=r.ts, value=float(r.avg_latency or 0)) for r in rows]


@router.get("/throughput-timeseries", response_model=list[TimeSeriesPoint])
async def get_throughput_timeseries(
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    since = since or _default_since()
    until = until or datetime.utcnow()

    q = text("""
        SELECT
            date_trunc('hour', request_timestamp) AS ts,
            COUNT(*) AS req_count
        FROM inference_logs
        WHERE request_timestamp BETWEEN :since AND :until
        GROUP BY 1
        ORDER BY 1
    """)

    rows = (await db.execute(q, {"since": since, "until": until})).fetchall()
    return [TimeSeriesPoint(timestamp=r.ts, value=float(r.req_count)) for r in rows]


@router.get("/error-timeseries", response_model=list[TimeSeriesPoint])
async def get_error_timeseries(
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    since = since or _default_since()
    until = until or datetime.utcnow()

    q = text("""
        SELECT
            date_trunc('hour', request_timestamp) AS ts,
            COUNT(*) FILTER (WHERE status = 'error') * 100.0 / NULLIF(COUNT(*), 0) AS error_rate
        FROM inference_logs
        WHERE request_timestamp BETWEEN :since AND :until
        GROUP BY 1
        ORDER BY 1
    """)

    rows = (await db.execute(q, {"since": since, "until": until})).fetchall()
    return [TimeSeriesPoint(timestamp=r.ts, value=float(r.error_rate or 0)) for r in rows]


@router.get("/providers", response_model=list[ProviderBreakdown])
async def get_provider_breakdown(
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    since = since or _default_since()
    until = until or datetime.utcnow()

    q = text("""
        SELECT
            provider,
            model,
            COUNT(*) AS request_count,
            AVG(latency_ms) AS avg_latency_ms,
            COUNT(*) FILTER (WHERE status = 'error') * 100.0 / NULLIF(COUNT(*), 0) AS error_rate,
            SUM(total_tokens) AS total_tokens,
            SUM(estimated_cost_usd) AS total_cost_usd
        FROM inference_logs
        WHERE request_timestamp BETWEEN :since AND :until
        GROUP BY provider, model
        ORDER BY request_count DESC
    """)

    rows = (await db.execute(q, {"since": since, "until": until})).fetchall()
    return [
        ProviderBreakdown(
            provider=r.provider,
            model=r.model,
            request_count=r.request_count,
            avg_latency_ms=float(r.avg_latency_ms) if r.avg_latency_ms else None,
            error_rate=float(r.error_rate) if r.error_rate else None,
            total_tokens=int(r.total_tokens) if r.total_tokens else None,
            total_cost_usd=float(r.total_cost_usd) if r.total_cost_usd else None,
        )
        for r in rows
    ]


@router.get("/recent-logs", response_model=list[dict])
async def get_recent_logs(
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(InferenceLog)
        .order_by(desc(InferenceLog.request_timestamp))
        .limit(limit)
    )
    logs = result.scalars().all()
    return [
        {
            "id": str(l.id),
            "provider": l.provider,
            "model": l.model,
            "status": l.status,
            "latency_ms": l.latency_ms,
            "total_tokens": l.total_tokens,
            "estimated_cost_usd": float(l.estimated_cost_usd) if l.estimated_cost_usd else None,
            "input_preview": l.input_preview,
            "output_preview": l.output_preview,
            "request_timestamp": l.request_timestamp.isoformat(),
            "is_streaming": l.is_streaming,
        }
        for l in logs
    ]
