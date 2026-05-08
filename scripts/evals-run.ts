/**
 * T-09: Eval Harness CLI – npm run ai -- evals:run
 *
 * 使い方:
 *   tsx scripts/evals-run.ts [--suite <name>] [--baseline <file>] [--output <file>] [--save-baseline] [--threshold <0-1>] [--ci]
 */

import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import {
  runEvals,
  saveBaseline,
  formatEvalSummary,
  fingerprintSuiteResult,
  type EvalCase
} from "../mcp/core/learning/eval-harness.js";
import { agentSelectionEvals } from "../tests/evals/agent-selection.eval.js";
import { promptTemplateEvals } from "../tests/evals/prompt-templates.eval.js";

// ── 利用可能なスイート ─────────────────────────────────────────────────────────

const SUITES: Record<string, EvalCase[]> = {
  "agent-selection": agentSelectionEvals,
  "prompt-templates": promptTemplateEvals,
  all: [...agentSelectionEvals, ...promptTemplateEvals]
};

// ── CLI 引数パース ────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    suite: { type: "string", short: "s", default: "all" },
    baseline: { type: "string", short: "b" },
    output: { type: "string", short: "o" },
    "save-baseline": { type: "boolean", default: false },
    threshold: { type: "string", default: "0.05" },
    ci: { type: "boolean", default: false },
    "list-suites": { type: "boolean", default: false }
  },
  strict: false
});

// ── list-suites ───────────────────────────────────────────────────────────────

if (args["list-suites"]) {
  console.log("Available eval suites:");
  for (const [name, cases] of Object.entries(SUITES)) {
    console.log(`  ${name.padEnd(20)} (${cases.length} cases)`);
  }
  process.exit(0);
}

// ── メイン ─────────────────────────────────────────────────────────────────────

const suiteName = String(args.suite ?? "all");
const cases = SUITES[suiteName];
if (!cases) {
  console.error(`Unknown suite: "${suiteName}". Available: ${Object.keys(SUITES).join(", ")}`);
  process.exit(1);
}

const outputsDir = resolve("outputs", "evals");
const defaultBaselineFile = join(outputsDir, "baselines", `${suiteName}.json`);
const baselineFile = args.baseline ? resolve(String(args.baseline)) : defaultBaselineFile;
const outputFile = args.output ? resolve(String(args.output)) : join(outputsDir, "latest", `${suiteName}.json`);
const regressionThreshold = Math.min(1, Math.max(0, parseFloat(String(args.threshold ?? "0.05"))));

// git sha（任意）
let gitSha: string | undefined;
try {
  const { execSync } = await import("node:child_process");
  gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
} catch {
  // git なし環境では無視
}

console.log(`\n🏃 Running eval suite: ${suiteName} (${cases.length} cases)`);
if (existsSync(baselineFile)) {
  console.log(`📊 Baseline: ${baselineFile}`);
} else {
  console.log(`ℹ  No baseline found at ${baselineFile} – skipping comparison`);
}

const { suite, comparison } = await runEvals({
  suiteName,
  cases,
  baselineFile: existsSync(baselineFile) ? baselineFile : undefined,
  regressionThreshold,
  outputFile,
  gitSha
});

// ── 結果表示 ──────────────────────────────────────────────────────────────────

console.log("\n" + formatEvalSummary(suite, comparison));

const fingerprint = fingerprintSuiteResult(suite);
console.log(`\nResult fingerprint: ${fingerprint}`);
console.log(`Output written: ${outputFile}`);

// --save-baseline
if (args["save-baseline"]) {
  await mkdir(resolve(join(outputsDir, "baselines")), { recursive: true });
  await saveBaseline(suite, baselineFile);
  console.log(`✅ Baseline saved: ${baselineFile}`);
}

// ── CI ゲート ─────────────────────────────────────────────────────────────────

if (comparison?.regressionDetected) {
  console.error(`\n❌ REGRESSION DETECTED (threshold=${regressionThreshold})`);
  if (comparison.regressed.length > 0) {
    console.error(`   Regressed cases: ${comparison.regressed.join(", ")}`);
  }
  if (args.ci) {
    process.exit(1);
  }
} else if (suite.failedCases > 0 && args.ci) {
  console.error(`\n❌ ${suite.failedCases} case(s) failed`);
  process.exit(1);
} else {
  if (suite.failedCases === 0) {
    console.log(`\n✅ All cases passed`);
  } else {
    console.log(`\n⚠  ${suite.failedCases} case(s) failed (not in CI mode, continuing)`);
  }
}
