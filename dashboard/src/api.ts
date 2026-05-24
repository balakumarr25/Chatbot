import axios from "axios";

// In dev: Vite proxies /api/* → ingestion API (strips /api prefix)
// In production: VITE_INGESTION_API_URL is set at build time
const INGESTION_BASE = import.meta.env.VITE_INGESTION_API_URL || "";
// Dev uses /api prefix (proxied), prod uses direct URL
const BASE = INGESTION_BASE || "/api";

export interface MetricsSummary {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  p99_latency_ms: number | null;
  total_tokens: number | null;
  total_cost_usd: number | null;
  error_rate: number | null;
}

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface ProviderBreakdown {
  provider: string;
  model: string;
  request_count: number;
  avg_latency_ms: number | null;
  error_rate: number | null;
  total_tokens: number | null;
  total_cost_usd: number | null;
}

export interface RecentLog {
  id: string;
  provider: string;
  model: string;
  status: string;
  latency_ms: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  input_preview: string | null;
  output_preview: string | null;
  request_timestamp: string;
  is_streaming: boolean;
}

export async function getSummary(since?: string, until?: string): Promise<MetricsSummary> {
  const params: Record<string, string> = {};
  if (since) params.since = since;
  if (until) params.until = until;
  const res = await axios.get(`${BASE}/metrics/summary`, { params });
  return res.data;
}

export async function getLatencyTimeseries(since?: string): Promise<TimeSeriesPoint[]> {
  const res = await axios.get(`${BASE}/metrics/latency-timeseries`, {
    params: since ? { since } : {},
  });
  return res.data;
}

export async function getThroughputTimeseries(since?: string): Promise<TimeSeriesPoint[]> {
  const res = await axios.get(`${BASE}/metrics/throughput-timeseries`, {
    params: since ? { since } : {},
  });
  return res.data;
}

export async function getErrorTimeseries(since?: string): Promise<TimeSeriesPoint[]> {
  const res = await axios.get(`${BASE}/metrics/error-timeseries`, {
    params: since ? { since } : {},
  });
  return res.data;
}

export async function getProviderBreakdown(since?: string): Promise<ProviderBreakdown[]> {
  const res = await axios.get(`${BASE}/metrics/providers`, {
    params: since ? { since } : {},
  });
  return res.data;
}

export async function getRecentLogs(limit = 20): Promise<RecentLog[]> {
  const res = await axios.get(`${BASE}/metrics/recent-logs`, { params: { limit } });
  return res.data;
}
