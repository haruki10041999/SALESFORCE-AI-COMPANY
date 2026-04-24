#!/usr/bin/env node
/**
 * metrics-dashboard.js
 *
 * metrics-samples.jsonl から静的 HTML ダッシュボードを生成します。
 *
 * 実行例:
 *   npm run metrics:dashboard
 *   npm run metrics:dashboard -- --top 12 --days 14
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_INPUT = process.env.SF_AI_METRICS_FILE
  ? resolve(process.env.SF_AI_METRICS_FILE)
  : join(ROOT, "outputs", "events", "metrics-samples.jsonl");
const DEFAULT_OUTPUT = join(ROOT, "outputs", "reports", "metrics-dashboard.html");
const DEFAULT_SNAPSHOT = join(ROOT, "docs", "metrics-snapshot.json");
const DEFAULT_EVENTS = join(ROOT, "outputs", "events", "system-events.jsonl");
const DEFAULT_ALERT_JSON = join(ROOT, "outputs", "reports", "metrics-alerts.json");
const DEFAULT_ALERT_MD = join(ROOT, "outputs", "reports", "metrics-alerts.md");

function parseArgs(argv) {
  const options = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    snapshot: "",
    events: DEFAULT_EVENTS,
    alertJson: DEFAULT_ALERT_JSON,
    alertMarkdown: DEFAULT_ALERT_MD,
    top: 10,
    days: 7,
    maxP95Ms: 200,
    maxErrorRatePercent: 5,
    minGovernanceCompliancePercent: 98,
    failOnAlert: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input" && argv[i + 1]) {
      options.input = resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--output" && argv[i + 1]) {
      options.output = resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--top" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) options.top = Math.min(parsed, 30);
      i += 1;
      continue;
    }
    if (token === "--snapshot" && argv[i + 1]) {
      options.snapshot = resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--days" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) options.days = Math.min(parsed, 90);
      i += 1;
      continue;
    }
    if (token === "--events" && argv[i + 1]) {
      options.events = resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--alert-json" && argv[i + 1]) {
      options.alertJson = resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--alert-markdown" && argv[i + 1]) {
      options.alertMarkdown = resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--max-p95-ms" && argv[i + 1]) {
      const parsed = Number.parseFloat(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 1) options.maxP95Ms = Math.min(parsed, 10000);
      i += 1;
      continue;
    }
    if (token === "--max-error-rate" && argv[i + 1]) {
      const parsed = Number.parseFloat(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) options.maxErrorRatePercent = parsed;
      i += 1;
      continue;
    }
    if (token === "--min-governance-rate" && argv[i + 1]) {
      const parsed = Number.parseFloat(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) options.minGovernanceCompliancePercent = parsed;
      i += 1;
      continue;
    }
    if (token === "--fail-on-alert") {
      options.failOnAlert = true;
      continue;
    }
  }

  return options;
}

function readSystemEvents(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((row) => row && typeof row.event === "string" && typeof row.timestamp === "string");
}

function isValidSummary(summary) {
  return Boolean(
    summary &&
    typeof summary.totalCalls === "number" &&
    typeof summary.totalErrors === "number" &&
    typeof summary.successRate === "number" &&
    typeof summary.p95Ms === "number" &&
    Array.isArray(summary.perTool) &&
    Array.isArray(summary.trend)
  );
}

function loadSummaryFromSnapshot(snapshotPath) {
  const target = snapshotPath || DEFAULT_SNAPSHOT;
  if (!existsSync(target)) {
    throw new Error(`snapshot file not found: ${target}`);
  }
  const raw = JSON.parse(readFileSync(target, "utf-8"));
  if (!isValidSummary(raw?.summary)) {
    throw new Error(`invalid snapshot format: ${target}`);
  }
  return { summary: raw.summary, sourcePath: target };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((sorted.length - 1) * (p / 100));
  return sorted[idx] ?? 0;
}

function readSamples(filePath) {
  if (!existsSync(filePath)) {
    console.warn(`[metrics-dashboard][warn] metrics file not found: ${filePath}`);
    return [];
  }

  return readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((row) => row && typeof row.toolName === "string" && typeof row.durationMs === "number" && typeof row.startedAt === "string" && (row.status === "success" || row.status === "error"));
}

function buildSummary(samples, topN, days) {
  const toolMap = new Map();
  for (const s of samples) {
    if (!toolMap.has(s.toolName)) toolMap.set(s.toolName, []);
    toolMap.get(s.toolName).push(s);
  }

  const perTool = [];
  for (const [toolName, list] of toolMap.entries()) {
    const durations = list.map((x) => x.durationMs).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
    const errors = list.filter((x) => x.status === "error").length;
    const success = list.length - errors;
    perTool.push({
      toolName,
      calls: list.length,
      errors,
      successRate: list.length === 0 ? 0 : Number((success / list.length).toFixed(3)),
      avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      p95Ms: Math.round(percentile(durations, 95))
    });
  }
  perTool.sort((a, b) => b.calls - a.calls);

  const totalCalls = samples.length;
  const totalErrors = samples.filter((x) => x.status === "error").length;
  const durations = samples.map((x) => x.durationMs).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const bucket = new Map();

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    bucket.set(key, { date: key, calls: 0, errors: 0 });
  }

  for (const s of samples) {
    const dt = new Date(s.startedAt);
    if (Number.isNaN(dt.getTime()) || dt < start || dt > end) continue;
    const key = dt.toISOString().slice(0, 10);
    const row = bucket.get(key);
    if (!row) continue;
    row.calls += 1;
    if (s.status === "error") row.errors += 1;
  }

  const trend = [...bucket.values()].map((x) => ({
    date: x.date,
    calls: x.calls,
    successRate: x.calls === 0 ? 1 : Number(((x.calls - x.errors) / x.calls).toFixed(3))
  }));

  return {
    generatedAt: new Date().toISOString(),
    totalCalls,
    totalErrors,
    successRate: totalCalls === 0 ? 1 : Number(((totalCalls - totalErrors) / totalCalls).toFixed(3)),
    p95Ms: Math.round(percentile(durations, 95)),
    perTool: perTool.slice(0, topN),
    trend
  };
}

function evaluateSla(summary, events, options) {
  const errorRatePercent = Number(((1 - summary.successRate) * 100).toFixed(2));
  const maxP95Ms = options.maxP95Ms;
  const maxErrorRatePercent = options.maxErrorRatePercent;
  const minGovernanceCompliancePercent = options.minGovernanceCompliancePercent;

  const end = new Date();
  const start = new Date(end.getTime() - options.days * 24 * 60 * 60 * 1000);

  let toolExecCount = 0;
  let thresholdExceededCount = 0;
  for (const evt of events) {
    const ts = new Date(evt.timestamp);
    if (Number.isNaN(ts.getTime()) || ts < start || ts > end) {
      continue;
    }
    if (evt.event === "tool_before_execute") {
      toolExecCount += 1;
    }
    if (evt.event === "governance_threshold_exceeded") {
      thresholdExceededCount += 1;
    }
  }

  const governanceCompliancePercent = toolExecCount > 0
    ? Number((((toolExecCount - thresholdExceededCount) / toolExecCount) * 100).toFixed(2))
    : null;

  const alerts = [];
  if (summary.p95Ms > maxP95Ms) {
    alerts.push({
      id: "sla-p95",
      severity: "high",
      metric: "overallP95Ms",
      value: summary.p95Ms,
      threshold: maxP95Ms,
      message: `Overall p95 exceeded threshold (${summary.p95Ms}ms > ${maxP95Ms}ms)`
    });
  }

  if (errorRatePercent > maxErrorRatePercent) {
    alerts.push({
      id: "sla-error-rate",
      severity: "high",
      metric: "errorRatePercent",
      value: errorRatePercent,
      threshold: maxErrorRatePercent,
      message: `Error rate exceeded threshold (${errorRatePercent}% > ${maxErrorRatePercent}%)`
    });
  }

  if (governanceCompliancePercent !== null && governanceCompliancePercent < minGovernanceCompliancePercent) {
    alerts.push({
      id: "sla-governance-compliance",
      severity: "medium",
      metric: "governanceCompliancePercent",
      value: governanceCompliancePercent,
      threshold: minGovernanceCompliancePercent,
      message: `Governance compliance dropped below threshold (${governanceCompliancePercent}% < ${minGovernanceCompliancePercent}%)`
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    periodDays: options.days,
    thresholds: {
      maxP95Ms,
      maxErrorRatePercent,
      minGovernanceCompliancePercent
    },
    values: {
      overallP95Ms: summary.p95Ms,
      errorRatePercent,
      governanceCompliancePercent,
      governanceThresholdExceededCount: thresholdExceededCount,
      toolExecutionCount: toolExecCount
    },
    alertCount: alerts.length,
    alerts
  };
}

function writeAlertReports(alertReport, jsonPath, markdownPath) {
  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(alertReport, null, 2), "utf-8");

  const lines = [];
  lines.push("# Metrics SLA Alerts");
  lines.push("");
  lines.push(`- generatedAt: ${alertReport.generatedAt}`);
  lines.push(`- periodDays: ${alertReport.periodDays}`);
  lines.push(`- alertCount: ${alertReport.alertCount}`);
  lines.push("");
  lines.push("## Thresholds");
  lines.push("");
  lines.push(`- maxP95Ms: ${alertReport.thresholds.maxP95Ms}`);
  lines.push(`- maxErrorRatePercent: ${alertReport.thresholds.maxErrorRatePercent}`);
  lines.push(`- minGovernanceCompliancePercent: ${alertReport.thresholds.minGovernanceCompliancePercent}`);
  lines.push("");
  lines.push("## Values");
  lines.push("");
  lines.push(`- overallP95Ms: ${alertReport.values.overallP95Ms}`);
  lines.push(`- errorRatePercent: ${alertReport.values.errorRatePercent}`);
  lines.push(`- governanceCompliancePercent: ${alertReport.values.governanceCompliancePercent ?? "N/A"}`);
  lines.push(`- governanceThresholdExceededCount: ${alertReport.values.governanceThresholdExceededCount}`);
  lines.push(`- toolExecutionCount: ${alertReport.values.toolExecutionCount}`);
  lines.push("");

  if (alertReport.alerts.length === 0) {
    lines.push("No SLA alerts detected.");
  } else {
    lines.push("## Alerts");
    lines.push("");
    lines.push("| severity | metric | value | threshold | message |");
    lines.push("|---|---|---:|---:|---|");
    for (const alert of alertReport.alerts) {
      lines.push(`| ${alert.severity} | ${alert.metric} | ${alert.value} | ${alert.threshold} | ${alert.message} |`);
    }
  }

  writeFileSync(markdownPath, lines.join("\n"), "utf-8");
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderHtml(summary, sourcePath, alertReport) {
  const labels = summary.trend.map((x) => x.date);
  const calls = summary.trend.map((x) => x.calls);
  const success = summary.trend.map((x) => Number((x.successRate * 100).toFixed(1)));

  const maxCalls = Math.max(1, ...calls);
  const callBars = summary.trend.map((x) => {
    const width = Math.max(2, Math.round((x.calls / maxCalls) * 100));
    return `<tr><td>${escapeHtml(x.date)}</td><td>${x.calls}</td><td><div class="bar"><span style="width:${width}%"></span></div></td><td>${(x.successRate * 100).toFixed(1)}%</td></tr>`;
  }).join("\n");

  const toolRows = summary.perTool.map((x) => `<tr><td>${escapeHtml(x.toolName)}</td><td>${x.calls}</td><td>${(x.successRate * 100).toFixed(1)}%</td><td>${x.errors}</td><td>${x.avgMs}</td><td>${x.p95Ms}</td></tr>`).join("\n");
  const alertRows = alertReport.alerts.length === 0
    ? `<tr><td colspan="5">No SLA alerts</td></tr>`
    : alertReport.alerts
      .map((a) => `<tr><td>${escapeHtml(a.severity)}</td><td>${escapeHtml(a.metric)}</td><td>${a.value}</td><td>${a.threshold}</td><td>${escapeHtml(a.message)}</td></tr>`)
      .join("\n");

  const metricRows = [
    {
      name: "Total Calls",
      formula: "期間内サンプル件数",
      interpretation: "処理ボリューム。急増時は負荷偏りを確認。",
      threshold: "前週平均比 +30% 超で要確認"
    },
    {
      name: "Error Count",
      formula: "status = error の件数",
      interpretation: "失敗回数。再試行や入力検証の改善候補。",
      threshold: "日次 5 件超で要確認"
    },
    {
      name: "Success Rate",
      formula: "(Total Calls - Error Count) / Total Calls",
      interpretation: "品質の主指標。高いほど安定。",
      threshold: "95% 未満で警戒"
    },
    {
      name: "Overall p95",
      formula: "durationMs の95パーセンタイル",
      interpretation: "レイテンシの上位5%の遅延。体感遅延に近い。",
      threshold: "200ms 超で警戒"
    },
    {
      name: "Tool p95",
      formula: "ツール別 durationMs の95パーセンタイル",
      interpretation: "どのツールが遅いかを特定。",
      threshold: "300ms 超のツールを優先改善"
    }
  ].map((x) => `<tr><td>${x.name}</td><td>${x.formula}</td><td>${x.interpretation}</td><td>${x.threshold}</td></tr>`).join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Metrics Dashboard</title>
<style>
:root{--bg:#f6f8f9;--ink:#1f2a30;--muted:#5b6a72;--card:#ffffff;--line:#dbe3e8;--accent:#0d7a6f;--warn:#b34d00}
*{box-sizing:border-box} body{margin:0;background:linear-gradient(180deg,#eef3f6 0%,#f8fbfc 100%);color:var(--ink);font-family:"Segoe UI",sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:24px}
h1{margin:0 0 8px 0;font-size:28px}
.meta{color:var(--muted);font-size:13px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.k{color:var(--muted);font-size:12px;margin:0 0 6px} .v{font-size:24px;font-weight:700;margin:0}
.section{margin-top:16px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
table{width:100%;border-collapse:collapse} th,td{padding:8px;border-bottom:1px solid var(--line);font-size:13px;text-align:left}
.bar{height:10px;background:#edf2f5;border-radius:999px;overflow:hidden}.bar span{display:block;height:100%;background:var(--accent)}
.small{font-size:12px;color:var(--muted)}
@media (max-width:860px){.grid{grid-template-columns:repeat(2,minmax(150px,1fr));}}
</style>
</head>
<body>
<div class="wrap">
  <h1>Metrics Dashboard</h1>
  <div class="meta">generated: ${escapeHtml(summary.generatedAt)} | source: ${escapeHtml(sourcePath)}</div>

  <div class="grid">
    <div class="card"><p class="k">Total Calls</p><p class="v">${summary.totalCalls}</p></div>
    <div class="card"><p class="k">Error Count</p><p class="v">${summary.totalErrors}</p></div>
    <div class="card"><p class="k">Success Rate</p><p class="v">${(summary.successRate * 100).toFixed(1)}%</p></div>
    <div class="card"><p class="k">Overall p95</p><p class="v">${summary.p95Ms} ms</p></div>
  </div>

  <div class="grid" style="margin-top:12px">
    <div class="card"><p class="k">SLA Alerts</p><p class="v">${alertReport.alertCount}</p></div>
    <div class="card"><p class="k">Error Rate</p><p class="v">${alertReport.values.errorRatePercent}%</p></div>
    <div class="card"><p class="k">Governance Compliance</p><p class="v">${alertReport.values.governanceCompliancePercent === null ? "N/A" : `${alertReport.values.governanceCompliancePercent}%`}</p></div>
    <div class="card"><p class="k">Governance Threshold Events</p><p class="v">${alertReport.values.governanceThresholdExceededCount}</p></div>
  </div>

  <div class="section">
    <h2>Daily Trend</h2>
    <p class="small">直近 ${summary.trend.length} 日の call 数と success rate。</p>
    <table>
      <thead><tr><th>Date</th><th>Calls</th><th>Volume</th><th>Success</th></tr></thead>
      <tbody>${callBars}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Top Tools</h2>
    <p class="small">呼び出し回数上位ツールの性能サマリー。</p>
    <table>
      <thead><tr><th>Tool</th><th>Calls</th><th>Success</th><th>Errors</th><th>Avg ms</th><th>p95 ms</th></tr></thead>
      <tbody>${toolRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>SLA Alerts</h2>
    <p class="small">通知先を持たない運用向け: レポート出力と CI 失敗判定で検知します。</p>
    <table>
      <thead><tr><th>Severity</th><th>Metric</th><th>Value</th><th>Threshold</th><th>Message</th></tr></thead>
      <tbody>${alertRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Metric Evaluation Method</h2>
    <p class="small">各評価指標の算出方法と解釈、運用しきい値。</p>
    <table>
      <thead><tr><th>Metric</th><th>Formula</th><th>Interpretation</th><th>Threshold</th></tr></thead>
      <tbody>${metricRows}</tbody>
    </table>
  </div>
</div>
<script>window.__metrics=${JSON.stringify({labels,calls,success})};</script>
</body>
</html>`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { summary, sourcePath } = options.snapshot
    ? loadSummaryFromSnapshot(options.snapshot)
    : (() => {
      const samples = readSamples(options.input);
      return { summary: buildSummary(samples, options.top, options.days), sourcePath: options.input };
    })();
  const events = readSystemEvents(options.events);
  const alertReport = evaluateSla(summary, events, options);
  const html = renderHtml(summary, sourcePath, alertReport);

  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, html, "utf-8");
  writeAlertReports(alertReport, options.alertJson, options.alertMarkdown);
  console.log(`[metrics-dashboard] wrote ${options.output}`);
  console.log(`[metrics-dashboard] wrote ${options.alertJson}`);
  console.log(`[metrics-dashboard] wrote ${options.alertMarkdown}`);

  if (alertReport.alertCount > 0) {
    for (const alert of alertReport.alerts) {
      console.warn(`[metrics-dashboard][alert] ${alert.message}`);
      if (process.env.GITHUB_ACTIONS === "true") {
        console.log(`::warning title=Metrics SLA Alert::${alert.message}`);
      }
    }
  }

  if (options.failOnAlert && alertReport.alertCount > 0) {
    throw new Error(`SLA alerts detected: ${alertReport.alertCount}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`[metrics-dashboard][ERROR] ${String(error)}`);
  process.exit(1);
}
