/**
 * A3: Governance ルール簡易 Web UI
 *
 * GovernanceState から人間可読な HTML ダッシュボードを生成する。
 * 副作用なしの純粋関数。HTML/Markdown/Summary を返し、
 * ファイル書き出しは呼び出し側 (handler) が担当する。
 */
import type { GovernanceState, GovernedResourceType } from "./governance-state.js";

export interface GovernanceUiOptions {
  generatedAt?: Date;
  /** 各リソースタイプの上位 N 件 */
  topPerType?: number;
  /** タイトル */
  title?: string;
}

export interface GovernanceUiSection {
  resourceType: GovernedResourceType;
  totalDisabled: number;
  totalUsage: number;
  flagged: Array<{ name: string; bugCount: number; threshold: number }>;
  topUsage: Array<{ name: string; usage: number }>;
  disabled: string[];
}

export interface GovernanceUiReport {
  generatedAt: string;
  thresholds: { minUsageToKeep: number; bugSignalToFlag: number };
  sections: GovernanceUiSection[];
  totals: { disabled: number; flagged: number };
  html: string;
  markdown: string;
}

const RESOURCE_TYPES: GovernedResourceType[] = ["skills", "tools", "presets"];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSection(
  type: GovernedResourceType,
  state: GovernanceState,
  topN: number
): GovernanceUiSection {
  const usage = state.usage?.[type] ?? {};
  const bugs = state.bugSignals?.[type] ?? {};
  const disabled = state.disabled?.[type] ?? [];
  const bugThreshold = state.config?.thresholds?.bugSignalToFlag ?? 2;

  const usageEntries = Object.entries(usage).map(([name, value]) => ({ name, usage: value }));
  const totalUsage = usageEntries.reduce((s, e) => s + e.usage, 0);

  const topUsage = [...usageEntries]
    .sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name))
    .slice(0, topN);

  const flagged = Object.entries(bugs)
    .filter(([, count]) => typeof count === "number" && count >= bugThreshold)
    .map(([name, bugCount]) => ({ name, bugCount: bugCount as number, threshold: bugThreshold }))
    .sort((a, b) => b.bugCount - a.bugCount || a.name.localeCompare(b.name));

  return {
    resourceType: type,
    totalDisabled: disabled.length,
    totalUsage,
    flagged,
    topUsage,
    disabled: [...disabled].sort()
  };
}

function renderMarkdown(
  generatedAt: string,
  title: string,
  sections: GovernanceUiSection[],
  totals: { disabled: number; flagged: number }
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- generated: ${generatedAt}`);
  lines.push(`- disabled total: ${totals.disabled}`);
  lines.push(`- flagged total: ${totals.flagged}`);
  lines.push("");
  for (const s of sections) {
    lines.push(`## ${s.resourceType}`);
    lines.push("");
    lines.push(`- usage total: ${s.totalUsage}`);
    lines.push(`- disabled: ${s.totalDisabled}`);
    if (s.flagged.length > 0) {
      lines.push(`- flagged:`);
      for (const f of s.flagged) {
        lines.push(`  - ${f.name} (bugs=${f.bugCount} ≥ ${f.threshold})`);
      }
    }
    if (s.topUsage.length > 0) {
      lines.push(`- top usage:`);
      for (const u of s.topUsage) {
        lines.push(`  - ${u.name}: ${u.usage}`);
      }
    }
    if (s.disabled.length > 0) {
      lines.push(`- disabled list: ${s.disabled.join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderHtml(
  generatedAt: string,
  title: string,
  thresholds: { minUsageToKeep: number; bugSignalToFlag: number },
  sections: GovernanceUiSection[],
  totals: { disabled: number; flagged: number }
): string {
  const sectionHtml = sections
    .map((s) => {
      const flaggedRows = s.flagged
        .map((f) => `<tr class="flagged"><td>${escapeHtml(f.name)}</td><td>${f.bugCount}</td></tr>`)
        .join("");
      const usageRows = s.topUsage
        .map((u) => `<tr><td>${escapeHtml(u.name)}</td><td>${u.usage}</td></tr>`)
        .join("");
      const disabledRows = s.disabled
        .map((d) => `<li>${escapeHtml(d)}</li>`)
        .join("");
      return `
<section>
  <h2>${escapeHtml(s.resourceType)}</h2>
  <div class="kpis">
    <span class="kpi">usage total: <b>${s.totalUsage}</b></span>
    <span class="kpi">disabled: <b>${s.totalDisabled}</b></span>
    <span class="kpi">flagged: <b>${s.flagged.length}</b></span>
  </div>
  <h3>Flagged (bugs ≥ ${thresholds.bugSignalToFlag})</h3>
  <table>
    <thead><tr><th>Name</th><th>Bugs</th></tr></thead>
    <tbody>${flaggedRows || "<tr><td colspan='2'>(none)</td></tr>"}</tbody>
  </table>
  <h3>Top Usage</h3>
  <table>
    <thead><tr><th>Name</th><th>Usage</th></tr></thead>
    <tbody>${usageRows || "<tr><td colspan='2'>(none)</td></tr>"}</tbody>
  </table>
  <h3>Disabled</h3>
  <ul>${disabledRows || "<li>(none)</li>"}</ul>
</section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem; color: #222; }
h1 { border-bottom: 2px solid #333; }
h2 { margin-top: 2rem; border-bottom: 1px solid #ccc; }
section { margin-bottom: 2rem; }
table { border-collapse: collapse; width: 100%; margin: 0.5rem 0 1rem; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
th { background: #f0f0f0; }
tr.flagged { background: #ffecec; }
.kpi { display: inline-block; margin-right: 1rem; padding: 0.4rem 0.8rem; background: #f6f6f6; border-radius: 6px; }
ul { margin: 0; padding-left: 1.2rem; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p><small>generated: ${escapeHtml(generatedAt)} · minUsageToKeep=${thresholds.minUsageToKeep} · bugSignalToFlag=${thresholds.bugSignalToFlag}</small></p>
<div class="kpis">
  <span class="kpi">Disabled: <b>${totals.disabled}</b></span>
  <span class="kpi">Flagged: <b>${totals.flagged}</b></span>
</div>
${sectionHtml}
</body>
</html>`;
}

export function renderGovernanceUi(
  state: GovernanceState,
  options: GovernanceUiOptions = {}
): GovernanceUiReport {
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const topN = options.topPerType ?? 10;
  const title = options.title ?? "Governance Dashboard";
  const thresholds = {
    minUsageToKeep: state.config?.thresholds?.minUsageToKeep ?? 2,
    bugSignalToFlag: state.config?.thresholds?.bugSignalToFlag ?? 2
  };

  const sections = RESOURCE_TYPES.map((t) => buildSection(t, state, topN));
  const totals = {
    disabled: sections.reduce((s, sec) => s + sec.totalDisabled, 0),
    flagged: sections.reduce((s, sec) => s + sec.flagged.length, 0)
  };

  return {
    generatedAt,
    thresholds,
    sections,
    totals,
    html: renderHtml(generatedAt, title, thresholds, sections, totals),
    markdown: renderMarkdown(generatedAt, title, sections, totals)
  };
}
