/**
 * T-09: Eval Harness CI runner
 *
 * Runs the repository eval suites in a CI-friendly way and fails on
 * regression or case failure.
 */

import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import {
  formatEvalSummary,
  fingerprintSuiteResult,
  runEvals,
  saveBaseline
} from "../mcp/core/learning/eval-harness.js";
import { PromptfooAdapter } from "../mcp/core/learning/adapters/promptfoo-adapter.js";
import { RagasAdapter } from "../mcp/core/learning/adapters/ragas-adapter.js";

type SuiteKey = "promptfoo" | "ragas" | "all" | "prompt-templates" | "agent-selection";

const { values: args } = parseArgs({
  options: {
    suite: { type: "string", short: "s", default: "all" },
    baselineDir: { type: "string" },
    outputDir: { type: "string" },
    threshold: { type: "string", default: "0.05" },
    ci: { type: "boolean", default: false },
    "save-baseline": { type: "boolean", default: false },
    "list-suites": { type: "boolean", default: false }
  },
  strict: false
});

const defaultBaselineDir = resolve("tests", "evals", "baselines");
const defaultOutputDir = resolve("outputs", "evals", "latest");
const suiteKey = String(args.suite ?? "all") as SuiteKey;

const adapters = {
  promptfoo: new PromptfooAdapter(join(defaultBaselineDir, "prompt-templates.json")),
  ragas: new RagasAdapter(join(defaultBaselineDir, "agent-selection.json"))
} as const;

function resolveSuiteKeys(): Array<keyof typeof adapters> {
  if (suiteKey === "all") {
    return ["promptfoo", "ragas"];
  }
  if (suiteKey === "promptfoo" || suiteKey === "ragas") {
    return [suiteKey];
  }
  if (suiteKey === "prompt-templates") {
    return ["promptfoo"];
  }
  if (suiteKey === "agent-selection") {
    return ["ragas"];
  }
  return ["promptfoo", "ragas"];
}

async function runSuite(adapterKey: keyof typeof adapters): Promise<{ name: string; failed: boolean }> {
  const adapter = adapters[adapterKey];
  const definition = adapter.getDefinition();
  const baselineDir = resolve(String(args.baselineDir ?? defaultBaselineDir));
  const outputDir = resolve(String(args.outputDir ?? defaultOutputDir));
  const baselineFile = join(baselineDir, `${definition.suiteName}.json`);
  const outputFile = join(outputDir, `${definition.suiteName}.json`);
  const threshold = Math.min(1, Math.max(0, parseFloat(String(args.threshold ?? "0.05"))));

  await mkdir(baselineDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const { suite, comparison } = await runEvals({
    suiteName: definition.suiteName,
    cases: definition.cases,
    baselineFile,
    regressionThreshold: threshold,
    outputFile,
    gitSha: process.env.GITHUB_SHA
  });

  console.log(`\n[${adapter.name}] ${definition.suiteName}`);
  console.log(formatEvalSummary(suite, comparison));
  console.log(`Fingerprint: ${fingerprintSuiteResult(suite)}`);
  console.log(`Output: ${outputFile}`);

  if (args["save-baseline"]) {
    await saveBaseline(suite, baselineFile);
    console.log(`Baseline saved: ${baselineFile}`);
  }

  const failed = Boolean(comparison?.regressionDetected) || suite.failedCases > 0;
  if (failed && args.ci) {
    console.error(`\n${definition.suiteName} failed CI gate`);
  }
  return { name: definition.suiteName, failed };
}

async function main(): Promise<number> {
  if (args["list-suites"]) {
    console.log("Available eval suites:");
    console.log("  promptfoo        (prompt-templates)");
    console.log("  ragas            (agent-selection)");
    console.log("  all              (both suites)");
    return 0;
  }

  const selected = resolveSuiteKeys();
  const results = await Promise.all(selected.map((key) => runSuite(key)));
  return results.some((result) => result.failed) && args.ci ? 1 : 0;
}

process.exitCode = await main();