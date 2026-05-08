import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";

import { createLogger } from "../mcp/core/logging/logger.js";
import { startObservabilityRuntime } from "../mcp/core/observability/runtime.js";
import {
  _resetPrometheusForTest,
  recordToolExecutionForPrometheus,
  getPrometheusMetricsText
} from "../mcp/core/observability/prometheus-metrics.js";
import {
  _resetOtelTracerForTest,
  notifyOtelTraceEnd,
  notifyOtelTraceFail,
  notifyOtelTraceStart
} from "../mcp/core/observability/otel-tracer.js";

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForPrometheusMetric(metricName: string, attempts = 8): Promise<string> {
  let last = "";
  for (let i = 0; i < attempts; i += 1) {
    const current = await getPrometheusMetricsText();
    last = current.text;
    if (last.includes(metricName)) return last;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return last;
}

test("observability runtime serves prometheus metrics endpoint", async () => {
  const oldPort = process.env.PROMETHEUS_METRICS_PORT;
  const oldOtel = process.env.OTEL_ENABLED;

  const port = await findFreePort();
  process.env.PROMETHEUS_METRICS_PORT = String(port);
  process.env.OTEL_ENABLED = "false";

  await _resetPrometheusForTest();
  recordToolExecutionForPrometheus({
    toolName: "e2e_prom_tool",
    status: "success",
    durationMs: 42
  });

  const runtime = await startObservabilityRuntime(createLogger("ObsE2E", "error"));
  try {
    const healthRes = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(healthRes.status, 200);
    const healthPayload = JSON.parse(await healthRes.text()) as { status: string };
    assert.equal(healthPayload.status, "ok");

    await waitForPrometheusMetric("sfai_tool_executions_total");

    const metricsRes = await fetch(`http://127.0.0.1:${port}/metrics`);
    assert.equal(metricsRes.status, 200);
    const metricsText = await metricsRes.text();
    assert.ok(metricsText.includes("sfai_tool_executions_total"));
    assert.ok(metricsText.includes("sfai_tool_duration_seconds"));
    assert.ok(metricsText.includes('tool="e2e_prom_tool"'));
  } finally {
    await runtime.stop();
    if (oldPort === undefined) {
      delete process.env.PROMETHEUS_METRICS_PORT;
    } else {
      process.env.PROMETHEUS_METRICS_PORT = oldPort;
    }
    if (oldOtel === undefined) {
      delete process.env.OTEL_ENABLED;
    } else {
      process.env.OTEL_ENABLED = oldOtel;
    }
  }
});

test("otel tracer handles start/end/fail lifecycle safely", async () => {
  const oldOtel = process.env.OTEL_ENABLED;
  const oldService = process.env.OTEL_SERVICE_NAME;

  process.env.OTEL_ENABLED = "true";
  process.env.OTEL_SERVICE_NAME = "sfai-otel-e2e";

  try {
    _resetOtelTracerForTest();

    notifyOtelTraceStart("trace-e2e-1", "deploy_org", { test: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    notifyOtelTraceEnd("trace-e2e-1", { finished: true });

    notifyOtelTraceStart("trace-e2e-2", "run_tests", { test: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    notifyOtelTraceFail("trace-e2e-2", new Error("boom"));

    _resetOtelTracerForTest();
    assert.ok(true);
  } finally {
    if (oldOtel === undefined) {
      delete process.env.OTEL_ENABLED;
    } else {
      process.env.OTEL_ENABLED = oldOtel;
    }
    if (oldService === undefined) {
      delete process.env.OTEL_SERVICE_NAME;
    } else {
      process.env.OTEL_SERVICE_NAME = oldService;
    }
  }
});
