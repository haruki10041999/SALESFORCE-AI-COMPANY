/**
 * T-09: Eval Harness – unit tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runEvals,
  saveBaseline,
  formatEvalSummary,
  fingerprintSuiteResult,
  type EvalCase,
  type EvalSuiteResult
} from "../../mcp/core/learning/eval-harness.js";
import { allKeywordsPresent, hasJsonFields, mcpContentContains, successRubric } from "./scoring-rubrics.js";

// ── テスト用ケース ──────────────────────────────────────────────────────────

const passingCase: EvalCase = {
  name: "passing-case",
  group: "unit",
  run: async () => "Hello Apex world",
  rubric: allKeywordsPresent(["apex"])
};

const failingCase: EvalCase = {
  name: "failing-case",
  group: "unit",
  run: async () => "Hello world",
  rubric: allKeywordsPresent(["apex"])
};

const errorCase: EvalCase = {
  name: "error-case",
  group: "unit",
  run: async () => { throw new Error("boom"); },
  rubric: successRubric
};

const skipCase: EvalCase = {
  name: "skip-case",
  group: "unit",
  run: async () => "never executed",
  rubric: successRubric,
  skip: true
};

const jsonCase: EvalCase = {
  name: "json-fields-case",
  group: "unit",
  run: async () => ({ success: true, count: 3, items: [] }),
  rubric: hasJsonFields(["success", "count"])
};

const mcpCase: EvalCase = {
  name: "mcp-content-case",
  group: "unit",
  run: async () => [{ type: "text", text: "Apex class created successfully" }],
  rubric: mcpContentContains(["apex", "class"])
};

// ── describe / it ───────────────────────────────────────────────────────────

describe("EvalHarness – runEvals", () => {
  it("passing case returns score=1 and passed=true", async () => {
    const { suite } = await runEvals({ suiteName: "test", cases: [passingCase] });
    assert.equal(suite.totalCases, 1);
    assert.equal(suite.passedCases, 1);
    assert.equal(suite.failedCases, 0);
    assert.ok(suite.results[0].passed);
    assert.equal(suite.results[0].score, 1);
  });

  it("failing case returns passed=false", async () => {
    const { suite } = await runEvals({ suiteName: "test", cases: [failingCase] });
    assert.equal(suite.passedCases, 0);
    assert.equal(suite.failedCases, 1);
    assert.ok(!suite.results[0].passed);
  });

  it("error case returns passed=false with error message", async () => {
    const { suite } = await runEvals({ suiteName: "test", cases: [errorCase] });
    assert.ok(!suite.results[0].passed);
    assert.ok(suite.results[0].error?.includes("boom"));
  });

  it("skip case is counted separately", async () => {
    const { suite } = await runEvals({ suiteName: "test", cases: [skipCase] });
    assert.equal(suite.skippedCases, 1);
    assert.equal(suite.passedCases, 0);
    assert.ok(suite.results[0].skipped);
  });

  it("averageScore counts only non-skipped cases", async () => {
    const { suite } = await runEvals({ suiteName: "test", cases: [passingCase, skipCase] });
    // only passingCase contributes → averageScore = 1
    assert.equal(suite.averageScore, 1);
  });

  it("json fields rubric works", async () => {
    const { suite } = await runEvals({ suiteName: "test", cases: [jsonCase] });
    assert.ok(suite.results[0].passed);
  });

  it("mcp content rubric works", async () => {
    const { suite } = await runEvals({ suiteName: "test", cases: [mcpCase] });
    assert.ok(suite.results[0].passed);
  });

  it("outputs file is written when outputFile is specified", async () => {
    const outputFile = join(tmpdir(), `eval-test-${Date.now()}.json`);
    await runEvals({ suiteName: "test", cases: [passingCase], outputFile });
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(outputFile, "utf-8");
    const parsed = JSON.parse(raw) as EvalSuiteResult;
    assert.equal(parsed.suiteName, "test");
  });
});

describe("EvalHarness – baseline comparison", () => {
  it("detects regression when score drops below threshold", async () => {
    const baselineFile = join(tmpdir(), `baseline-${Date.now()}.json`);

    // 最初の実行でベースラインを保存 (passing)
    const { suite: baselineSuite } = await runEvals({ suiteName: "cmp", cases: [passingCase] });
    await saveBaseline(baselineSuite, baselineFile);

    // 次の実行では failing case でスコアが落ちる
    const { comparison } = await runEvals({
      suiteName: "cmp",
      cases: [failingCase],
      baselineFile,
      regressionThreshold: 0.05
    });

    assert.ok(comparison !== undefined);
    assert.ok(comparison!.regressionDetected, "regression should be detected");
    assert.ok(comparison!.regressed.includes("failing-case") || comparison!.averageScoreDelta < 0);
  });

  it("no regression when score is maintained", async () => {
    const baselineFile = join(tmpdir(), `baseline2-${Date.now()}.json`);
    const { suite } = await runEvals({ suiteName: "cmp", cases: [passingCase] });
    await saveBaseline(suite, baselineFile);

    const { comparison } = await runEvals({
      suiteName: "cmp",
      cases: [passingCase],
      baselineFile,
      regressionThreshold: 0.05
    });

    assert.ok(comparison !== undefined);
    assert.ok(!comparison!.regressionDetected, "no regression expected");
  });

  it("treats missing baseline as new cases (no regression)", async () => {
    const { comparison } = await runEvals({
      suiteName: "cmp",
      cases: [passingCase],
      baselineFile: join(tmpdir(), "nonexistent.json"),
      regressionThreshold: 0.05
    });

    assert.ok(!comparison!.regressionDetected);
    assert.ok(comparison!.newCases.includes("passing-case"));
  });
});

describe("EvalHarness – formatting", () => {
  it("formatEvalSummary returns a non-empty string", async () => {
    const { suite } = await runEvals({ suiteName: "fmt", cases: [passingCase, failingCase] });
    const summary = formatEvalSummary(suite);
    assert.ok(summary.length > 0);
    assert.ok(summary.includes("fmt"));
  });

  it("fingerprintSuiteResult returns a hex string", async () => {
    const { suite } = await runEvals({ suiteName: "fp", cases: [passingCase] });
    const fp = fingerprintSuiteResult(suite);
    assert.match(fp, /^[0-9a-f]{16}$/);
  });
});

describe("EvalHarness – eval case definitions", () => {
  it("agentSelectionEvals has at least 4 cases", async () => {
    const { agentSelectionEvals } = await import("./agent-selection.eval.js");
    assert.ok(agentSelectionEvals.length >= 4);
  });

  it("promptTemplateEvals has at least 3 cases", async () => {
    const { promptTemplateEvals } = await import("./prompt-templates.eval.js");
    assert.ok(promptTemplateEvals.length >= 3);
  });

  it("all agent-selection cases run without throwing", async () => {
    const { agentSelectionEvals } = await import("./agent-selection.eval.js");
    const { suite } = await runEvals({ suiteName: "agent-sel", cases: agentSelectionEvals });
    // no case should have an error (even if score is low)
    for (const r of suite.results) {
      assert.ok(!r.error, `case ${r.name} threw: ${r.error}`);
    }
  });

  it("all prompt-template cases run without throwing", async () => {
    const { promptTemplateEvals } = await import("./prompt-templates.eval.js");
    const { suite } = await runEvals({ suiteName: "prompt-tpl", cases: promptTemplateEvals });
    for (const r of suite.results) {
      assert.ok(!r.error, `case ${r.name} threw: ${r.error}`);
    }
  });
});
