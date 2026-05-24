import React, { useEffect, useState, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from "recharts";
import { format, subHours, subDays } from "date-fns";
import {
  getSummary, getLatencyTimeseries, getThroughputTimeseries,
  getErrorTimeseries, getProviderBreakdown, getRecentLogs,
  MetricsSummary, TimeSeriesPoint, ProviderBreakdown, RecentLog,
} from "./api";
import { StatCard } from "./components/StatCard";

const COLORS = ["#6366f1", "#22d3ee", "#f59e0b", "#10b981", "#f43f5e", "#a78bfa"];

type TimeRange = "1h" | "6h" | "24h" | "7d";

function sinceFromRange(range: TimeRange): string {
  const now = new Date();
  switch (range) {
    case "1h": return subHours(now, 1).toISOString();
    case "6h": return subHours(now, 6).toISOString();
    case "24h": return subHours(now, 24).toISOString();
    case "7d": return subDays(now, 7).toISOString();
  }
}

function fmt(ts: string) {
  return format(new Date(ts), "HH:mm");
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(4)}`;
}

export default function App() {
  const [range, setRange] = useState<TimeRange>("24h");
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [latency, setLatency] = useState<TimeSeriesPoint[]>([]);
  const [throughput, setThroughput] = useState<TimeSeriesPoint[]>([]);
  const [errors, setErrors] = useState<TimeSeriesPoint[]>([]);
  const [providers, setProviders] = useState<ProviderBreakdown[]>([]);
  const [logs, setLogs] = useState<RecentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const load = useCallback(async () => {
    const since = sinceFromRange(range);
    try {
      const [s, lat, thr, err, prov, lg] = await Promise.all([
        getSummary(since),
        getLatencyTimeseries(since),
        getThroughputTimeseries(since),
        getErrorTimeseries(since),
        getProviderBreakdown(since),
        getRecentLogs(20),
      ]);
      setSummary(s);
      setLatency(lat);
      setThroughput(thr);
      setErrors(err);
      setProviders(prov);
      setLogs(lg);
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Failed to load metrics:", e);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  // Pie chart data for provider distribution
  const providerPieData = providers.reduce<Record<string, number>>((acc, p) => {
    acc[p.provider] = (acc[p.provider] || 0) + p.request_count;
    return acc;
  }, {});
  const pieData = Object.entries(providerPieData).map(([name, value]) => ({ name, value }));

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center font-bold text-sm">L</div>
            <div>
              <h1 className="font-semibold">LLM Inference Dashboard</h1>
              <p className="text-xs text-gray-500">Last updated: {format(lastRefresh, "HH:mm:ss")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(["1h", "6h", "24h", "7d"] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                  range === r
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {r}
              </button>
            ))}
            <a
              href="http://localhost:3000"
              target="_blank"
              className="ml-2 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
            >
              Open Chatbot →
            </a>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {loading && !summary ? (
          <div className="flex items-center justify-center h-64 text-gray-500">Loading metrics...</div>
        ) : (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              <div className="col-span-2">
                <StatCard
                  label="Total Requests"
                  value={fmtNum(summary?.total_requests)}
                  sub={`${fmtNum(summary?.successful_requests)} successful`}
                  color="blue"
                />
              </div>
              <div className="col-span-2">
                <StatCard
                  label="Error Rate"
                  value={summary?.error_rate != null ? `${summary.error_rate.toFixed(1)}%` : "—"}
                  sub={`${fmtNum(summary?.failed_requests)} failed`}
                  color={summary?.error_rate != null && summary.error_rate > 5 ? "red" : "green"}
                />
              </div>
              <div className="col-span-2">
                <StatCard
                  label="Avg Latency"
                  value={fmtMs(summary?.avg_latency_ms)}
                  sub={`p95: ${fmtMs(summary?.p95_latency_ms)}`}
                  color="yellow"
                />
              </div>
              <div className="col-span-2">
                <StatCard
                  label="Total Cost"
                  value={fmtCost(summary?.total_cost_usd)}
                  sub={`${fmtNum(summary?.total_tokens)} tokens`}
                  color="default"
                />
              </div>
            </div>

            {/* Latency percentiles */}
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="P50 Latency" value={fmtMs(summary?.p50_latency_ms)} color="green" />
              <StatCard label="P95 Latency" value={fmtMs(summary?.p95_latency_ms)} color="yellow" />
              <StatCard label="P99 Latency" value={fmtMs(summary?.p99_latency_ms)} color="red" />
            </div>

            {/* Charts row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Latency chart */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-4">Avg Latency Over Time</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={latency}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="timestamp" tickFormatter={fmt} tick={{ fontSize: 11, fill: "#6b7280" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickFormatter={(v) => `${v}ms`} />
                    <Tooltip
                      contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                      labelFormatter={(v) => format(new Date(v), "MMM d HH:mm")}
                      formatter={(v: number) => [`${Math.round(v)}ms`, "Avg Latency"]}
                    />
                    <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Throughput chart */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-4">Requests Per Hour</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={throughput}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="timestamp" tickFormatter={fmt} tick={{ fontSize: 11, fill: "#6b7280" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} />
                    <Tooltip
                      contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                      labelFormatter={(v) => format(new Date(v), "MMM d HH:mm")}
                      formatter={(v: number) => [v, "Requests"]}
                    />
                    <Bar dataKey="value" fill="#22d3ee" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Charts row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Error rate chart */}
              <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-4">Error Rate (%)</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={errors}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="timestamp" tickFormatter={fmt} tick={{ fontSize: 11, fill: "#6b7280" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                      formatter={(v: number) => [`${v.toFixed(1)}%`, "Error Rate"]}
                    />
                    <Line type="monotone" dataKey="value" stroke="#f43f5e" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Provider pie */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-4">Provider Distribution</h3>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value">
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                      />
                      <Legend iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-40 text-gray-600 text-sm">No data</div>
                )}
              </div>
            </div>

            {/* Provider breakdown table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-4">Provider / Model Breakdown</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
                      <th className="text-left py-2 pr-4">Provider</th>
                      <th className="text-left py-2 pr-4">Model</th>
                      <th className="text-right py-2 pr-4">Requests</th>
                      <th className="text-right py-2 pr-4">Avg Latency</th>
                      <th className="text-right py-2 pr-4">Error Rate</th>
                      <th className="text-right py-2 pr-4">Tokens</th>
                      <th className="text-right py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-gray-600">No data for this time range</td>
                      </tr>
                    ) : (
                      providers.map((p, i) => (
                        <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                          <td className="py-2.5 pr-4">
                            <span className="px-2 py-0.5 bg-indigo-900/30 text-indigo-300 rounded text-xs">{p.provider}</span>
                          </td>
                          <td className="py-2.5 pr-4 text-gray-300 font-mono text-xs">{p.model}</td>
                          <td className="py-2.5 pr-4 text-right text-gray-200">{fmtNum(p.request_count)}</td>
                          <td className="py-2.5 pr-4 text-right text-yellow-400">{fmtMs(p.avg_latency_ms)}</td>
                          <td className={`py-2.5 pr-4 text-right ${p.error_rate && p.error_rate > 5 ? "text-red-400" : "text-emerald-400"}`}>
                            {p.error_rate != null ? `${p.error_rate.toFixed(1)}%` : "0%"}
                          </td>
                          <td className="py-2.5 pr-4 text-right text-gray-400">{fmtNum(p.total_tokens)}</td>
                          <td className="py-2.5 text-right text-gray-400">{fmtCost(p.total_cost_usd)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent logs */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-4">Recent Inference Logs</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 uppercase tracking-wide border-b border-gray-800">
                      <th className="text-left py-2 pr-3">Time</th>
                      <th className="text-left py-2 pr-3">Provider</th>
                      <th className="text-left py-2 pr-3">Model</th>
                      <th className="text-left py-2 pr-3">Status</th>
                      <th className="text-right py-2 pr-3">Latency</th>
                      <th className="text-right py-2 pr-3">Tokens</th>
                      <th className="text-left py-2 pr-3">Input Preview</th>
                      <th className="text-left py-2">Output Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-gray-600">No logs yet — send a message in the chatbot</td>
                      </tr>
                    ) : (
                      logs.map((log) => (
                        <tr key={log.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                          <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                            {format(new Date(log.request_timestamp), "HH:mm:ss")}
                          </td>
                          <td className="py-2 pr-3">
                            <span className="px-1.5 py-0.5 bg-indigo-900/30 text-indigo-300 rounded">{log.provider}</span>
                          </td>
                          <td className="py-2 pr-3 text-gray-400 font-mono">{log.model.split("-").slice(0, 3).join("-")}</td>
                          <td className="py-2 pr-3">
                            <span className={`px-1.5 py-0.5 rounded ${
                              log.status === "success" ? "bg-emerald-900/30 text-emerald-400" : "bg-red-900/30 text-red-400"
                            }`}>
                              {log.status}
                              {log.is_streaming && " ⚡"}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-right text-yellow-400">{fmtMs(log.latency_ms)}</td>
                          <td className="py-2 pr-3 text-right text-gray-400">{fmtNum(log.total_tokens)}</td>
                          <td className="py-2 pr-3 text-gray-500 max-w-[150px] truncate">{log.input_preview || "—"}</td>
                          <td className="py-2 text-gray-500 max-w-[150px] truncate">{log.output_preview || "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
