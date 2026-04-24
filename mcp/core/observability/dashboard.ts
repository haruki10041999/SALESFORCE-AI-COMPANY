/**
 * Unified Observability Dashboard (TASK-044)
 *
 * trace + system_event + governance_state を join して、
 * 「いつ・どのツールで・どの状態だったか」を一望できる単一ページを生成する。
 *
 * 設計:
 * - 純粋関数で受け取った snapshot から HTML/Markdown/Summary を生成
 * - 副作用 (ファイル I/O) は呼び出し側 (handler) が担当
 * - エラー発生時点付近の system event を突き合わせる timeline view
 * - resource governance flagged のリソースを併記
 */

export interface ObservabilityTrace {
  traceId: string;
  toolName: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: "running" | "success" | "error";
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface ObservabilityEvent {
  id: string;
  event: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface ObservabilityGovernanceFlagged {
  resourceType: "skills" | "tools" | "presets";
  name: string;
  reason: string;
}

export interface ObservabilityInput {
  traces: ObservabilityTrace[];
  events: ObservabilityEvent[];
  governanceFlagged?: ObservabilityGovernanceFlagged[];
  /** タイムウィンドウ。trace endedAt から ±msEnvelope の event を関連付ける。デフォルト 5000ms */
  correlationWindowMs?: number;
  /** 出力件数の上限（直近 N 件）。デフォルト 50 */
  recentLimit?: number;
}

export interface ObservabilitySummary {
  generatedAt: string;
  traceCount: number;
  errorTraceCount: number;
  successTraceCount: number;
  errorRate: number;
  eventCount: number;
  governanceFlaggedCount: number;
  topFailingTools: Array<{ toolName: string; failures: number }>;
}

export interface ObservabilityCorrelation {
  traceId: string;
  toolName: string;
  status: "running" | "success" | "error";
  errorMessage?: string;
  endedAt?: string;
  /** trace 終了時刻 ±correlationWindowMs に発生した system event */
  relatedEvents: ObservabilityEvent[];
}

export interface ObservabilityReport {
  summary: ObservabilitySummary;
  correlations: ObservabilityCorrelation[];
  governanceFlagged: ObservabilityGovernanceFlagged[];
  html: string;
  markdown: string;
}

const DEFAULT_CORRELATION_WINDOW = 5000;
const DEFAULT_RECENT_LIMIT = 50;

function safeTime(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSummary(input: ObservabilityInput): ObservabilitySummary {
  const traceCount = input.traces.length;
  let errorTraceCount = 0;
  let successTraceCount = 0;
  const failingToolMap = new Map<string, number>();

  for (const t of input.traces) {
    if (t.status === "error") {
      errorTraceCount += 1;
      failingToolMap.set(t.toolName, (failingToolMap.get(t.toolName) ?? 0) + 1);
    } else if (t.status === "success") {
      successTraceCount += 1;
    }
  }

  const totalFinished = errorTraceCount + successTraceCount;
  const errorRate = totalFinished === 0 ? 0 : errorTraceCount / totalFinished;

  const topFailingTools = [...failingToolMap.entries()]
    .map(([toolName, failures]) => ({ toolName, failures }))
    .sort((a, b) => b.failures - a.failures)
    .slice(0, 5);

  return {
    generatedAt: new Date().toISOString(),
    traceCount,
    errorTraceCount,
    successTraceCount,
    errorRate,
    eventCount: input.events.length,
    governanceFlaggedCount: input.governanceFlagged?.length ?? 0,
    topFailingTools
  };
}

function correlateEventsWithTraces(
  input: ObservabilityInput
): ObservabilityCorrelation[] {
  const window = input.correlationWindowMs ?? DEFAULT_CORRELATION_WINDOW;
  const limit = input.recentLimit ?? DEFAULT_RECENT_LIMIT;
  const events = input.events;

  // 直近 limit 件 (endedAt または startedAt 降順)
  const sortedTraces = [...input.traces].sort((a, b) => {
    const ta = safeTime(a.endedAt) ?? safeTime(a.startedAt) ?? 0;
    const tb = safeTime(b.endedAt) ?? safeTime(b.startedAt) ?? 0;
    return tb - ta;
  }).slice(0, limit);

  return sortedTraces.map((trace) => {
    const center = safeTime(trace.endedAt) ?? safeTime(trace.startedAt);
    const related: ObservabilityEvent[] = [];
    if (center !== null) {
      for (const ev of events) {
        const t = safeTime(ev.timestamp);
        if (t === null) continue;
        if (Math.abs(t - center) <= window) {
          related.push(ev);
        }
      }
      // 時刻順
      related.sort((a, b) => (safeTime(a.timestamp) ?? 0) - (safeTime(b.timestamp) ?? 0));
    }
    return {
      traceId: trace.traceId,
      toolName: trace.toolName,
      status: trace.status,
      errorMessage: trace.errorMessage,
      endedAt: trace.endedAt,
      relatedEvents: related
    };
  });
}

function renderMarkdown(
  summary: ObservabilitySummary,
  correlations: ObservabilityCorrelation[],
  flagged: ObservabilityGovernanceFlagged[]
): string {
  const lines: string[] = [];
  lines.push(`# Observability Dashboard`);
  lines.push("");
  lines.push(`- generated: ${summary.generatedAt}`);
  lines.push(`- traces: ${summary.traceCount} (success ${summary.successTraceCount} / error ${summary.errorTraceCount})`);
  lines.push(`- error rate: ${(summary.errorRate * 100).toFixed(1)}%`);
  lines.push(`- events: ${summary.eventCount}`);
  lines.push(`- governance flagged: ${summary.governanceFlaggedCount}`);
  lines.push("");

  if (summary.topFailingTools.length > 0) {
    lines.push(`## Top Failing Tools`);
    lines.push("");
    for (const t of summary.topFailingTools) {
      lines.push(`- ${t.toolName}: ${t.failures} failures`);
    }
    lines.push("");
  }

  if (flagged.length > 0) {
    lines.push(`## Governance Flagged`);
    lines.push("");
    for (const f of flagged) {
      lines.push(`- [${f.resourceType}] ${f.name} — ${f.reason}`);
    }
    lines.push("");
  }

  lines.push(`## Recent Trace Correlations`);
  lines.push("");
  for (const c of correlations) {
    const statusBadge = c.status === "error" ? "🔴" : c.status === "success" ? "🟢" : "⚪";
    lines.push(`### ${statusBadge} ${c.toolName} (${c.traceId})`);
    if (c.errorMessage) lines.push(`- error: ${c.errorMessage}`);
    if (c.endedAt) lines.push(`- endedAt: ${c.endedAt}`);
    if (c.relatedEvents.length === 0) {
      lines.push(`- related events: (none)`);
    } else {
      lines.push(`- related events:`);
      for (const ev of c.relatedEvents) {
        lines.push(`  - ${ev.timestamp} \`${ev.event}\``);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderHtml(
  summary: ObservabilitySummary,
  correlations: ObservabilityCorrelation[],
  flagged: ObservabilityGovernanceFlagged[]
): string {
  const correlationRows = correlations
    .map((c) => {
      const evs = c.relatedEvents
        .map((e) => `<li><code>${escapeHtml(e.timestamp)}</code> ${escapeHtml(e.event)}</li>`)
        .join("");
      const statusClass = c.status === "error" ? "err" : c.status === "success" ? "ok" : "running";
      return `
<tr class="${statusClass}">
  <td>${escapeHtml(c.traceId)}</td>
  <td>${escapeHtml(c.toolName)}</td>
  <td>${escapeHtml(c.status)}</td>
  <td>${escapeHtml(c.endedAt ?? "")}</td>
  <td>${escapeHtml(c.errorMessage ?? "")}</td>
  <td><ul>${evs || "<li>(none)</li>"}</ul></td>
</tr>`;
    })
    .join("");

  const flaggedRows = flagged
    .map(
      (f) => `<tr><td>${escapeHtml(f.resourceType)}</td><td>${escapeHtml(f.name)}</td><td>${escapeHtml(f.reason)}</td></tr>`
    )
    .join("");

  const failingRows = summary.topFailingTools
    .map((t) => `<tr><td>${escapeHtml(t.toolName)}</td><td>${t.failures}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>Observability Dashboard</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem; color: #222; }
h1 { border-bottom: 2px solid #333; }
table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f0f0f0; }
tr.err { background: #ffecec; }
tr.ok { background: #ecffec; }
tr.running { background: #fffbe0; }
.kpi { display: inline-block; margin-right: 1.5rem; padding: 0.5rem 1rem; background: #f6f6f6; border-radius: 6px; }
ul { margin: 0; padding-left: 1.2rem; }
</style>
</head>
<body>
<h1>Observability Dashboard</h1>
<p><small>generated: ${escapeHtml(summary.generatedAt)}</small></p>
<div>
  <span class="kpi">Traces: <b>${summary.traceCount}</b></span>
  <span class="kpi">Success: <b>${summary.successTraceCount}</b></span>
  <span class="kpi">Errors: <b>${summary.errorTraceCount}</b></span>
  <span class="kpi">Error rate: <b>${(summary.errorRate * 100).toFixed(1)}%</b></span>
  <span class="kpi">Events: <b>${summary.eventCount}</b></span>
  <span class="kpi">Flagged: <b>${summary.governanceFlaggedCount}</b></span>
</div>
<h2>Top Failing Tools</h2>
<table>
  <thead><tr><th>Tool</th><th>Failures</th></tr></thead>
  <tbody>${failingRows || "<tr><td colspan='2'>(none)</td></tr>"}</tbody>
</table>
<h2>Governance Flagged</h2>
<table>
  <thead><tr><th>Type</th><th>Name</th><th>Reason</th></tr></thead>
  <tbody>${flaggedRows || "<tr><td colspan='3'>(none)</td></tr>"}</tbody>
</table>
<h2>Recent Trace Correlations</h2>
<table>
  <thead>
    <tr><th>Trace</th><th>Tool</th><th>Status</th><th>EndedAt</th><th>Error</th><th>Related Events</th></tr>
  </thead>
  <tbody>${correlationRows || "<tr><td colspan='6'>(no traces)</td></tr>"}</tbody>
</table>
</body>
</html>`;
}

/**
 * trace + event + governance を join して dashboard レポートを生成する。
 */
export function buildObservabilityDashboard(input: ObservabilityInput): ObservabilityReport {
  const summary = buildSummary(input);
  const correlations = correlateEventsWithTraces(input);
  const flagged = input.governanceFlagged ?? [];
  const markdown = renderMarkdown(summary, correlations, flagged);
  const html = renderHtml(summary, correlations, flagged);
  return { summary, correlations, governanceFlagged: flagged, html, markdown };
}
