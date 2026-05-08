import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateSloBurn, formatSloBurnResult, SloMetrics } from "../../mcp/core/observability/slo-burn-tracker.js";

test("calculateSloBurn computes correct error rate for success rate SLO", () => {
  const metrics: SloMetrics = {
    successRate: 0.99,  // 1% error rate
    latencyP95Ms: 800,
    costPerChat: 0.4,
    timestamp: new Date().toISOString()
  };

  const results = calculateSloBurn(metrics, "30d");
  const successRateSlo = results.find(r => r.sloId === "success_rate");

  assert.ok(successRateSlo);
  assert.equal(successRateSlo.currentValue, 0.99);
  assert.equal(successRateSlo.sloTarget, 0.995);
  assert.ok(Math.abs(successRateSlo.errorRate - 0.01) < 0.0001);
});

test("calculateSloBurn calculates burn rate correctly", () => {
  const metrics: SloMetrics = {
    successRate: 0.99, // 1% error vs 0.5% allowed = 2× burn
    latencyP95Ms: 900,
    costPerChat: 0.4,
    timestamp: new Date().toISOString()
  };

  const results = calculateSloBurn(metrics, "30d");
  const successRateSlo = results.find(r => r.sloId === "success_rate");

  assert.ok(successRateSlo);
  const expectedBurnRate = 0.01 / 0.005;
  assert.ok(Math.abs(successRateSlo.burnRate - expectedBurnRate) < 0.0001);
});

test("calculateSloBurn detects critical alert at 14.4× burn rate", () => {
  const metrics: SloMetrics = {
    successRate: 0.92, // 8% error vs 0.5% allowed = 16× burn (critical)
    latencyP95Ms: 900,
    costPerChat: 0.4,
    timestamp: new Date().toISOString()
  };

  const results = calculateSloBurn(metrics, "30d");
  const successRateSlo = results.find(r => r.sloId === "success_rate");

  assert.ok(successRateSlo);
  assert.ok(successRateSlo.burnRate > 14.4);
  assert.equal(successRateSlo.alertLevel, "critical");
});

test("calculateSloBurn detects warning at 1× burn rate", () => {
  const metrics: SloMetrics = {
    successRate: 0.985, // 1.5% error vs 0.5% allowed = 3× burn (warning)
    latencyP95Ms: 900,
    costPerChat: 0.4,
    timestamp: new Date().toISOString()
  };

  const results = calculateSloBurn(metrics, "30d");
  const successRateSlo = results.find(r => r.sloId === "success_rate");

  assert.ok(successRateSlo);
  assert.ok(successRateSlo.burnRate > 1.0);
  assert.equal(successRateSlo.alertLevel, "warning");
});

test("calculateSloBurn reports no alert when SLO is met", () => {
  const metrics: SloMetrics = {
    successRate: 0.997, // well above 99.5%
    latencyP95Ms: 800,
    costPerChat: 0.4,
    timestamp: new Date().toISOString()
  };

  const results = calculateSloBurn(metrics, "30d");
  const successRateSlo = results.find(r => r.sloId === "success_rate");

  assert.ok(successRateSlo);
  assert.ok(successRateSlo.burnRate < 1.0);
  assert.equal(successRateSlo.alertLevel, "none");
});

test("calculateSloBurn tracks latency P95 SLO", () => {
  const metrics: SloMetrics = {
    successRate: 0.997,
    latencyP95Ms: 1200, // 200ms over target (1000ms)
    costPerChat: 0.4,
    timestamp: new Date().toISOString()
  };

  const results = calculateSloBurn(metrics, "30d");
  const latencySlo = results.find(r => r.sloId === "latency_p95");

  assert.ok(latencySlo);
  assert.equal(latencySlo.sloTarget, 1000);
  assert.equal(latencySlo.currentValue, 1200);
  assert.equal(latencySlo.errorRate, 200);
});

test("formatSloBurnResult produces readable output", () => {
  const metrics: SloMetrics = {
    successRate: 0.99,
    latencyP95Ms: 1200,
    costPerChat: 0.6,
    timestamp: new Date().toISOString()
  };

  const results = calculateSloBurn(metrics, "30d");
  const formatted = results.map(r => formatSloBurnResult(r));

  assert.ok(formatted.length === 3);
  assert.ok(formatted.every(f => typeof f === "string"));
  assert.ok(formatted[0].includes("success_rate"));
  assert.ok(formatted[0].includes("CRITICAL") || formatted[0].includes("WARNING"));
});

test("calculateSloBurn tracks cost per chat SLO", () => {
  const metrics: SloMetrics = {
    successRate: 0.997,
    latencyP95Ms: 900,
    costPerChat: 0.6, // $0.10 over target
    timestamp: new Date().toISOString()
  };

  const results = calculateSloBurn(metrics, "30d");
  const costSlo = results.find(r => r.sloId === "cost_per_chat");

  assert.ok(costSlo);
  assert.equal(costSlo.sloTarget, 0.5);
  assert.equal(costSlo.currentValue, 0.6);
});

test("calculateSloBurn uses correct windows (5m, 1h, 1d, 30d)", () => {
  const metrics: SloMetrics = {
    successRate: 0.99,
    latencyP95Ms: 900,
    costPerChat: 0.4,
    timestamp: new Date().toISOString()
  };

  const windows: Array<"5m" | "1h" | "1d" | "30d"> = ["5m", "1h", "1d", "30d"];
  for (const window of windows) {
    const results = calculateSloBurn(metrics, window);
    results.forEach(r => {
      assert.equal(r.window, window);
      assert.ok(r.budgetRemainingSec >= 0);
    });
  }
});
