import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  startTrace,
  endTrace,
  failTrace,
  getCompletedTraces,
  configureTraceStorageForTest,
  clearTraceStorageForTest
} from "../mcp/core/trace/trace-context.js";
import { summarizeMetrics } from "../mcp/tools/metrics-summary.js";
import { runBenchmarkSuite } from "../mcp/tools/benchmark-suite.js";
import { generateDeploymentPlan } from "../mcp/tools/deployment-plan-generator.js";
import {
  recordMetric,
  getMetricsSummary,
  resetMetrics,
  configureMetricsStorageForTest
} from "../mcp/tools/metrics.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

test("trace context records success and error traces", () => {
  const ok = startTrace("trace_success_case");
  endTrace(ok);

  const ng = startTrace("trace_error_case");
  failTrace(ng, new Error("expected"));

  const traces = getCompletedTraces(20);
  const success = traces.find((t) => t.traceId === ok);
  const failure = traces.find((t) => t.traceId === ng);

  assert.equal(success?.status, "success");
  assert.equal(failure?.status, "error");
});

test("summarizeMetrics returns expected aggregate fields", () => {
  const t1 = startTrace("metrics_case_1");
  endTrace(t1);

  const t2 = startTrace("metrics_case_2");
  failTrace(t2, "boom");

  const result = summarizeMetrics({ limit: 50 });
  assert.equal(typeof result.activeCount, "number");
  assert.equal(typeof result.completedCount, "number");
  assert.equal(typeof result.successRate, "number");
  assert.equal(typeof result.errorRate, "number");
  assert.ok(Array.isArray(result.slowest));
});

test("runBenchmarkSuite returns valid score and grade", () => {
  const result = runBenchmarkSuite({
    scenarios: ["Apex review", "LWC optimization"],
    recentTraceLimit: 100
  });

  assert.equal(typeof result.overallScore, "number");
  assert.ok(["A", "B", "C", "D"].includes(result.grade));
  assert.ok(result.metricsSnapshot.successRate >= 0);
  assert.ok(Array.isArray(result.recommendations));
});

test("generateDeploymentPlan creates plan from git diff", () => {
  const repoPath = mkdtempSync(join(tmpdir(), "sf-ai-deployment-plan-test-"));
  try {
    git(repoPath, ["init"]);
    git(repoPath, ["config", "user.email", "test@example.com"]);
    git(repoPath, ["config", "user.name", "test-user"]);
    git(repoPath, ["checkout", "-b", "main"]);

    writeText(
      join(repoPath, "force-app", "main", "default", "classes", "OrderService.cls"),
      "public with sharing class OrderService {}\n"
    );
    git(repoPath, ["add", "."]);
    git(repoPath, ["commit", "-m", "base"]);

    git(repoPath, ["checkout", "-b", "feature/plan-test"]);
    writeText(
      join(repoPath, "force-app", "main", "default", "flows", "OrderFlow.flow-meta.xml"),
      "<Flow></Flow>\n"
    );
    git(repoPath, ["add", "."]);
    git(repoPath, ["commit", "-m", "add flow"]);

    const result = generateDeploymentPlan({
      repoPath,
      baseBranch: "main",
      workingBranch: "feature/plan-test",
      targetOrg: "devhub"
    });

    assert.ok(["low", "medium", "high"].includes(result.riskLevel));
    assert.ok(result.recommendedOrder.length > 0);
    assert.ok(result.preChecks.length > 0);
    assert.ok(result.postChecks.length > 0);
    assert.ok(result.rollbackHints.length > 0);
  } finally {
    rmSync(repoPath, { recursive: true, force: true });
  }
});

test("trace context persists completed traces to disk", () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-trace-store-test-"));
  const filePath = join(root, "trace-log.jsonl");
  try {
    configureTraceStorageForTest(filePath);
    clearTraceStorageForTest();

    const id = startTrace("trace_persist_case");
    endTrace(id, { from: "test" });

    // reload from disk to verify persistence path works
    configureTraceStorageForTest(filePath);
    const restored = getCompletedTraces(20);
    assert.ok(restored.some((t) => t.traceId === id));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("metrics samples persist to disk", () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-metrics-store-test-"));
  const filePath = join(root, "metrics-samples.jsonl");
  try {
    configureMetricsStorageForTest(filePath);
    resetMetrics();

    recordMetric({
      toolName: "metrics_persist_case",
      startedAt: new Date().toISOString(),
      durationMs: 25,
      status: "success"
    });

    // reload from disk to verify persistence
    configureMetricsStorageForTest(filePath);
    const summary = getMetricsSummary();
    assert.ok(summary.totalCalls >= 1);
    assert.ok(summary.perTool.some((t) => t.toolName === "metrics_persist_case"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("summarizeMetrics and benchmark suite remain stable with high trace volume", () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-trace-stress-test-"));
  const filePath = join(root, "trace-log.jsonl");

  try {
    configureTraceStorageForTest(filePath);
    clearTraceStorageForTest();

    // Generate a high number of traces to emulate stress conditions.
    for (let i = 0; i < 700; i += 1) {
      const traceId = startTrace(`stress_tool_${i % 7}`);
      if (i % 10 === 0) {
        failTrace(traceId, new Error("stress error"));
      } else {
        endTrace(traceId);
      }
    }

    const summary = summarizeMetrics({ limit: 1000 });
    assert.ok(summary.completedCount > 0);
    assert.ok(summary.completedCount <= 500);
    assert.ok(summary.successRate >= 0 && summary.successRate <= 1);
    assert.ok(summary.errorRate >= 0 && summary.errorRate <= 1);

    const benchmark = runBenchmarkSuite({
      scenarios: ["stress-chat", "stress-orchestration", "stress-governance"],
      recentTraceLimit: 1000
    });
    assert.equal(typeof benchmark.overallScore, "number");
    assert.ok(["A", "B", "C", "D"].includes(benchmark.grade));
    assert.ok(benchmark.cases.length === 3);
  } finally {
    clearTraceStorageForTest();
    rmSync(root, { recursive: true, force: true });
  }
});
