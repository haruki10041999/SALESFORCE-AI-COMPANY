#!/usr/bin/env node
/**
 * sla-dashboard.js
 *
 * outputs/audit/sla-journal.jsonl から時系列グラフを生成し、
 * HTML ダッシュボードを出力します。
 *
 * 実行例:
 *   node scripts/sla-dashboard.js
 *   node scripts/sla-dashboard.js --output site/sla.html
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

const AUDIT_DIR = join(ROOT, "outputs", "audit");
const SLA_JOURNAL = join(AUDIT_DIR, "sla-journal.jsonl");
const DEFAULT_OUTPUT = join(ROOT, "outputs", "reports", "sla-dashboard.html");

interface SLAEntry {
  date: string;
  timestamp: string;
  successRate: number;
  p95DurationMs: number;
  totalCount: number;
  failureCount: number;
  alertLevel: "ok" | "warning" | "critical";
  alertReason?: string;
  toolFailures?: Array<{ toolName: string; errorRate: number; failureCount: number }>;
}

function readSLAJournal(path) {
  if (!existsSync(path)) {
    console.warn(`[warn] SLA journal not found: ${path}`);
    return [];
  }

  try {
    return readFileSync(path, "utf-8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((e) => e !== null);
  } catch (err) {
    console.error(`[error] failed to read SLA journal: ${err.message}`);
    return [];
  }
}

function generateHTML(entries) {
  if (entries.length === 0) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SLA Dashboard</title>
  <style>
    body { font-family: sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <div class="container">
    <h1>SLA Dashboard</h1>
    <p>No SLA records available yet. Start collecting metrics to see trends.</p>
  </div>
</body>
</html>
    `;
  }

  // データ準備
  const dates = entries.map((e) => e.date);
  const successRates = entries.map((e) => (e.successRate * 100).toFixed(2));
  const p95s = entries.map((e) => e.p95DurationMs);
  const failureCounts = entries.map((e) => e.failureCount);

  // 統計計算
  const avgSuccessRate = (
    entries.reduce((sum, e) => sum + e.successRate, 0) / entries.length * 100
  ).toFixed(2);
  const avgP95 = (entries.reduce((sum, e) => sum + e.p95DurationMs, 0) / entries.length).toFixed(
    0
  );
  const totalToolFailures = entries.reduce((acc, e) => {
    if (!e.toolFailures) return acc;
    e.toolFailures.forEach((tf) => {
      acc[tf.toolName] = (acc[tf.toolName] || 0) + tf.failureCount;
    });
    return acc;
  }, {});

  const alertCounts = {
    ok: entries.filter((e) => e.alertLevel === "ok").length,
    warning: entries.filter((e) => e.alertLevel === "warning").length,
    critical: entries.filter((e) => e.alertLevel === "critical").length
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SLA Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { font-size: 2em; margin-bottom: 10px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px; }
    .stat-box { padding: 15px; border-radius: 8px; border-left: 4px solid; }
    .stat-box.ok { background: #d4edda; border-color: #28a745; color: #155724; }
    .stat-box.warning { background: #fff3cd; border-color: #ffc107; color: #856404; }
    .stat-box.critical { background: #f8d7da; border-color: #dc3545; color: #721c24; }
    .stat-label { font-size: 0.9em; opacity: 0.8; }
    .stat-value { font-size: 1.8em; font-weight: bold; }
    .chart-container { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .chart-title { font-size: 1.2em; margin-bottom: 15px; font-weight: 600; }
    canvas { max-height: 300px; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    table th { background: #f0f0f0; padding: 10px; text-align: left; font-weight: 600; border-bottom: 2px solid #ddd; }
    table td { padding: 10px; border-bottom: 1px solid #ddd; }
    table tr:hover { background: #f9f9f9; }
    .alert-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; font-weight: 600; }
    .alert-badge.ok { background: #d4edda; color: #155724; }
    .alert-badge.warning { background: #fff3cd; color: #856404; }
    .alert-badge.critical { background: #f8d7da; color: #721c24; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📊 SLA Performance Dashboard</h1>
      <p>Tracking success rate, latency, and system health over time</p>
      <div class="stats">
        <div class="stat-box ok">
          <div class="stat-label">Avg Success Rate (${alertCounts.ok} OK days)</div>
          <div class="stat-value">${avgSuccessRate}%</div>
        </div>
        <div class="stat-box warning">
          <div class="stat-label">Avg p95 Latency (${alertCounts.warning} Warning days)</div>
          <div class="stat-value">${avgP95}ms</div>
        </div>
        <div class="stat-box critical">
          <div class="stat-label">Alert Summary (${alertCounts.critical} Critical days)</div>
          <div class="stat-value">${alertCounts.ok} OK / ${alertCounts.warning} ⚠️ / ${alertCounts.critical} 🚨</div>
        </div>
      </div>
    </header>

    <div class="chart-container">
      <div class="chart-title">Success Rate Trend</div>
      <canvas id="successChart"></canvas>
    </div>

    <div class="chart-container">
      <div class="chart-title">p95 Latency Trend (ms)</div>
      <canvas id="p95Chart"></canvas>
    </div>

    <div class="chart-container">
      <div class="chart-title">Daily Failures</div>
      <canvas id="failureChart"></canvas>
    </div>

    <div class="chart-container">
      <div class="chart-title">Recent SLA Records</div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Status</th>
            <th>Success Rate</th>
            <th>p95 (ms)</th>
            <th>Total Count</th>
            <th>Failures</th>
            <th>Alert Reason</th>
          </tr>
        </thead>
        <tbody>
${entries
  .slice(-30) // 直近 30 日
  .reverse()
  .map(
    (e) =>
      `<tr>
            <td>${e.date}</td>
            <td><span class="alert-badge ${e.alertLevel}">${e.alertLevel.toUpperCase()}</span></td>
            <td>${(e.successRate * 100).toFixed(2)}%</td>
            <td>${e.p95DurationMs}</td>
            <td>${e.totalCount}</td>
            <td>${e.failureCount}</td>
            <td>${e.alertReason || "-"}</td>
          </tr>`
  )
  .join("\n")}
        </tbody>
      </table>
    </div>

    <script>
      const ctx1 = document.getElementById('successChart').getContext('2d');
      new Chart(ctx1, {
        type: 'line',
        data: {
          labels: ${JSON.stringify(dates)},
          datasets: [{
            label: 'Success Rate (%)',
            data: ${JSON.stringify(successRates)},
            borderColor: '#28a745',
            backgroundColor: 'rgba(40, 167, 69, 0.1)',
            fill: true,
            tension: 0.3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { min: 85, max: 101 } }
        }
      });

      const ctx2 = document.getElementById('p95Chart').getContext('2d');
      new Chart(ctx2, {
        type: 'line',
        data: {
          labels: ${JSON.stringify(dates)},
          datasets: [{
            label: 'p95 Latency (ms)',
            data: ${JSON.stringify(p95s)},
            borderColor: '#ffc107',
            backgroundColor: 'rgba(255, 193, 7, 0.1)',
            fill: true,
            tension: 0.3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } }
        }
      });

      const ctx3 = document.getElementById('failureChart').getContext('2d');
      new Chart(ctx3, {
        type: 'bar',
        data: {
          labels: ${JSON.stringify(dates)},
          datasets: [{
            label: 'Failure Count',
            data: ${JSON.stringify(failureCounts)},
            backgroundColor: 'rgba(220, 53, 69, 0.7)',
            borderColor: '#dc3545',
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } }
        }
      });
    </script>
  </div>
</body>
</html>
  `;
}

async function main() {
  // 出力ディレクトリ作成
  const output = process.argv[3] === "--output" ? process.argv[4] : DEFAULT_OUTPUT;
  mkdirSync(dirname(output), { recursive: true });

  // SLA ジャーナル読込
  const entries = readSLAJournal(SLA_JOURNAL);
  console.log(`[info] loaded ${entries.length} SLA records from ${SLA_JOURNAL}`);

  // HTML 生成
  const html = generateHTML(entries);
  writeFileSync(output, html, "utf-8");
  console.log(`[info] SLA dashboard generated: ${output}`);
}

main().catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exit(1);
});
