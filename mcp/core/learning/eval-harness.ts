/**
 * T-09: Eval Harness – Offline Benchmark + CI Gate
 *
 * Eval ケースを `EvalCase` 形式で定義し、tool-recorder の replay モードまたは
 * 実行モードで回し、scorer で評価して baseline と比較する。
 *
 * 使い方:
 *   import { runEvals } from "./eval-harness.js";
 *   const result = await runEvals({ cases, baselineFile });
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

// ── 型定義 ──────────────────────────────────────────────────────────────────

/** 単一 eval ケースの評価基準 */
export interface EvalRubric {
  /** 出力に含まれることを期待するキーワード */
  mustContain?: string[];
  /** 出力に含まれてはいけないキーワード */
  mustNotContain?: string[];
  /** 期待する最小スコア（0–1）。scorer が返す数値と比較 */
  minScore?: number;
  /** カスタム採点関数。戻り値は 0–1 */
  scorer?: (output: unknown) => number | Promise<number>;
}

/** 単一 eval ケースの定義 */
export interface EvalCase {
  /** ケースの一意な名前 */
  name: string;
  /** 評価対象の関数（tool handler 相当） */
  run: () => Promise<unknown>;
  /** 採点基準 */
  rubric: EvalRubric;
  /** このケースをスキップするか（CI 環境など） */
  skip?: boolean;
  /** グループラベル（任意） */
  group?: string;
}

/** 単一 eval ケースの実行結果 */
export interface EvalResult {
  name: string;
  group?: string;
  score: number;
  passed: boolean;
  durationMs: number;
  error?: string;
  output?: unknown;
  skipped?: boolean;
}

/** eval 実行全体の集計結果 */
export interface EvalSuiteResult {
  suiteName: string;
  runAt: string;
  gitSha?: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  skippedCases: number;
  averageScore: number;
  results: EvalResult[];
}

/** baseline との比較結果 */
export interface EvalComparison {
  improved: string[];
  regressed: string[];
  unchanged: string[];
  newCases: string[];
  removedCases: string[];
  averageScoreDelta: number;
  regressionDetected: boolean;
}

// ── スコアリング ─────────────────────────────────────────────────────────────

function extractText(output: unknown): string {
  if (typeof output === "string") {
    return output.toLowerCase();
  }
  if (Array.isArray(output)) {
    return output
      .map((item) => {
        if (typeof item === "object" && item !== null && "text" in item) {
          return String((item as { text?: unknown }).text ?? "");
        }
        return String(item);
      })
      .join(" ")
      .toLowerCase();
  }
  return JSON.stringify(output).toLowerCase();
}

/**
 * rubric ベースのルールスコアリング。
 * - mustContain / mustNotContain: keyword 単位で 0/1 判定 → 平均
 * - minScore: scorer が返す値 or keyword 平均と比較
 */
async function scoreWithRubric(output: unknown, rubric: EvalRubric): Promise<number> {
  const parts: number[] = [];

  const text = extractText(output);

  if (rubric.mustContain && rubric.mustContain.length > 0) {
    for (const kw of rubric.mustContain) {
      parts.push(text.includes(kw.toLowerCase()) ? 1 : 0);
    }
  }

  if (rubric.mustNotContain && rubric.mustNotContain.length > 0) {
    for (const kw of rubric.mustNotContain) {
      parts.push(text.includes(kw.toLowerCase()) ? 0 : 1);
    }
  }

  if (rubric.scorer) {
    const customScore = await rubric.scorer(output);
    parts.push(Math.min(1, Math.max(0, customScore)));
  }

  if (parts.length === 0) {
    // rubric に基準なし → 実行できたこと自体を 1.0 とみなす
    return 1.0;
  }

  return parts.reduce((sum, v) => sum + v, 0) / parts.length;
}

// ── 実行 ───────────────────────────────────────────────────────────────────

/** 単一ケースを実行して EvalResult を返す */
async function runCase(evalCase: EvalCase): Promise<EvalResult> {
  if (evalCase.skip) {
    return {
      name: evalCase.name,
      group: evalCase.group,
      score: 0,
      passed: false,
      durationMs: 0,
      skipped: true
    };
  }

  const start = Date.now();
  try {
    const output = await evalCase.run();
    const durationMs = Date.now() - start;
    const score = await scoreWithRubric(output, evalCase.rubric);
    const minScore = evalCase.rubric.minScore ?? 0.5;
    return {
      name: evalCase.name,
      group: evalCase.group,
      score,
      passed: score >= minScore,
      durationMs,
      output
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    return {
      name: evalCase.name,
      group: evalCase.group,
      score: 0,
      passed: false,
      durationMs,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

// ── メインエントリ ────────────────────────────────────────────────────────────

export interface RunEvalsOptions {
  suiteName?: string;
  cases: EvalCase[];
  /** JSON baseline ファイルのパス。省略時は baseline 比較をスキップ */
  baselineFile?: string;
  /** baseline 比較で検知する最大許容スコア低下幅（0–1）。デフォルト 0.05 */
  regressionThreshold?: number;
  /** 結果を書き出す JSON ファイルパス（任意） */
  outputFile?: string;
  /** git sha（任意）。baseline commit を記録する用途 */
  gitSha?: string;
}

export async function runEvals(options: RunEvalsOptions): Promise<{
  suite: EvalSuiteResult;
  comparison?: EvalComparison;
}> {
  const {
    suiteName = "default",
    cases,
    baselineFile,
    regressionThreshold = 0.05,
    outputFile,
    gitSha
  } = options;

  const results = await Promise.all(cases.map(runCase));

  const passed = results.filter((r) => r.passed && !r.skipped);
  const failed = results.filter((r) => !r.passed && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const scorable = results.filter((r) => !r.skipped);
  const averageScore =
    scorable.length > 0
      ? scorable.reduce((sum, r) => sum + r.score, 0) / scorable.length
      : 1;

  const suite: EvalSuiteResult = {
    suiteName,
    runAt: new Date().toISOString(),
    gitSha,
    totalCases: cases.length,
    passedCases: passed.length,
    failedCases: failed.length,
    skippedCases: skipped.length,
    averageScore,
    results
  };

  // 結果を書き出す
  if (outputFile) {
    await mkdir(dirname(resolve(outputFile)), { recursive: true });
    await writeFile(resolve(outputFile), JSON.stringify(suite, null, 2), "utf-8");
  }

  // baseline 比較
  let comparison: EvalComparison | undefined;
  if (baselineFile) {
    comparison = await compareWithBaseline(suite, baselineFile, regressionThreshold);
  }

  return { suite, comparison };
}

// ── baseline 管理 ────────────────────────────────────────────────────────────

export async function saveBaseline(suite: EvalSuiteResult, baselineFile: string): Promise<void> {
  await mkdir(dirname(resolve(baselineFile)), { recursive: true });
  await writeFile(resolve(baselineFile), JSON.stringify(suite, null, 2), "utf-8");
}

async function compareWithBaseline(
  suite: EvalSuiteResult,
  baselineFile: string,
  regressionThreshold: number
): Promise<EvalComparison> {
  let baseline: EvalSuiteResult;
  try {
    const raw = await readFile(resolve(baselineFile), "utf-8");
    baseline = JSON.parse(raw) as EvalSuiteResult;
  } catch {
    // baseline が存在しない → 全件を new cases として扱う
    return {
      improved: [],
      regressed: [],
      unchanged: suite.results.map((r) => r.name),
      newCases: suite.results.map((r) => r.name),
      removedCases: [],
      averageScoreDelta: 0,
      regressionDetected: false
    };
  }

  const baselineMap = new Map(baseline.results.map((r) => [r.name, r]));
  const suiteMap = new Map(suite.results.map((r) => [r.name, r]));

  const improved: string[] = [];
  const regressed: string[] = [];
  const unchanged: string[] = [];
  const newCases: string[] = [];
  const removedCases: string[] = [];

  for (const result of suite.results) {
    const base = baselineMap.get(result.name);
    if (!base) {
      newCases.push(result.name);
      continue;
    }
    const delta = result.score - base.score;
    if (delta > 0.001) {
      improved.push(result.name);
    } else if (delta < -regressionThreshold) {
      regressed.push(result.name);
    } else {
      unchanged.push(result.name);
    }
  }

  for (const baseName of baselineMap.keys()) {
    if (!suiteMap.has(baseName)) {
      removedCases.push(baseName);
    }
  }

  const averageScoreDelta = suite.averageScore - baseline.averageScore;

  return {
    improved,
    regressed,
    unchanged,
    newCases,
    removedCases,
    averageScoreDelta,
    regressionDetected: regressed.length > 0 || averageScoreDelta < -regressionThreshold
  };
}

// ── ユーティリティ ────────────────────────────────────────────────────────────

/** ケースグループ別にサマリを表示する文字列を生成 */
export function formatEvalSummary(suite: EvalSuiteResult, comparison?: EvalComparison): string {
  const lines: string[] = [
    `=== Eval Suite: ${suite.suiteName} ===`,
    `Run at: ${suite.runAt}`,
    suite.gitSha ? `Git SHA: ${suite.gitSha}` : "",
    "",
    `Total: ${suite.totalCases}  Pass: ${suite.passedCases}  Fail: ${suite.failedCases}  Skip: ${suite.skippedCases}`,
    `Average score: ${(suite.averageScore * 100).toFixed(1)}%`,
    ""
  ].filter((l) => l !== undefined);

  // グループ別
  const byGroup = new Map<string, EvalResult[]>();
  for (const r of suite.results) {
    const g = r.group ?? "(no group)";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(r);
  }

  for (const [group, results] of byGroup) {
    lines.push(`--- ${group} ---`);
    for (const r of results) {
      const status = r.skipped ? "SKIP" : r.passed ? " OK " : "FAIL";
      const scoreStr = r.skipped ? "  -  " : `${(r.score * 100).toFixed(0).padStart(3)}%`;
      const errStr = r.error ? ` [${r.error.slice(0, 60)}]` : "";
      lines.push(`  [${status}] ${scoreStr}  ${r.name}${errStr}`);
    }
  }

  if (comparison) {
    lines.push("");
    lines.push("=== Baseline Comparison ===");
    lines.push(`Score delta: ${comparison.averageScoreDelta >= 0 ? "+" : ""}${(comparison.averageScoreDelta * 100).toFixed(1)}%`);
    if (comparison.improved.length > 0) {
      lines.push(`Improved (${comparison.improved.length}): ${comparison.improved.join(", ")}`);
    }
    if (comparison.regressed.length > 0) {
      lines.push(`REGRESSED (${comparison.regressed.length}): ${comparison.regressed.join(", ")}`);
    }
    if (comparison.newCases.length > 0) {
      lines.push(`New cases (${comparison.newCases.length}): ${comparison.newCases.join(", ")}`);
    }
    if (comparison.regressionDetected) {
      lines.push("⚠ REGRESSION DETECTED");
    } else {
      lines.push("✓ No regression");
    }
  }

  return lines.join("\n");
}

/** EvalResult を JSON 用に SHA256 フィンガープリントを付けてシリアライズ */
export function fingerprintSuiteResult(suite: EvalSuiteResult): string {
  const body = JSON.stringify({ suiteName: suite.suiteName, results: suite.results.map((r) => ({ name: r.name, score: r.score })) });
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}
