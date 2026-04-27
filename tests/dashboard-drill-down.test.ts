import { test } from "node:test";
import { strict as assert } from "node:assert";
import { drillDownDashboard } from "../mcp/core/observability/dashboard-drill-down.js";
import type { ObservabilityTrace, ObservabilityEvent } from "../mcp/core/observability/dashboard.js";

const t0 = Date.parse("2026-01-01T00:00:00Z");

function trace(idx: number, opts: Partial<ObservabilityTrace> = {}): ObservabilityTrace {
  const startedAt = new Date(t0 + idx * 60_000).toISOString();
  const endedAt = new Date(t0 + idx * 60_000 + 1000).toISOString();
  return {
    traceId: `trace-${idx}`,
    toolName: opts.toolName ?? "tool_a",
    startedAt,
    endedAt,
    durationMs: 1000,
    status: opts.status ?? "success",
    errorMessage: opts.errorMessage,
    ...opts
  };
}

function event(idx: number, evt: string, deltaMs: number): ObservabilityEvent {
  return {
    id: `ev-${idx}`,
    event: evt,
    timestamp: new Date(t0 + idx * 60_000 + deltaMs).toISOString()
  };
}

test("A15: filter by toolName narrows the result set", () => {
  const traces = [
    trace(0, { toolName: "tool_a" }),
    trace(1, { toolName: "tool_b" }),
    trace(2, { toolName: "tool_a" })
  ];
  const r = drillDownDashboard(traces, [], { toolName: "tool_a" });
  assert.equal(r.aggregates.matchedTraces, 2);
  assert.ok(r.details.every((d) => d.trace.toolName === "tool_a"));
});

test("A15: filter by status counts errors and surfaces error messages", () => {
  const traces = [
    trace(0, { status: "error", errorMessage: "boom" }),
    trace(1, { status: "error", errorMessage: "boom" }),
    trace(2, { status: "success" })
  ];
  const r = drillDownDashboard(traces, [], { status: "error" });
  assert.equal(r.aggregates.matchedTraces, 2);
  assert.equal(r.aggregates.errorCount, 2);
  assert.equal(r.aggregates.errorMessages[0].message, "boom");
  assert.equal(r.aggregates.errorMessages[0].count, 2);
});

test("A15: time window filter applies to both traces and events", () => {
  const traces = [trace(0), trace(5), trace(10)];
  const events = [event(0, "x", 0), event(5, "x", 0), event(10, "x", 0)];
  const since = new Date(t0 + 4 * 60_000).toISOString();
  const until = new Date(t0 + 6 * 60_000).toISOString();
  const r = drillDownDashboard(traces, events, { since, until });
  assert.equal(r.aggregates.matchedTraces, 1);
  assert.equal(r.aggregates.matchedEvents, 1);
});

test("A15: related events are correlated within the 5s window", () => {
  const traces = [trace(0)];
  const events = [event(0, "near", 1000), event(0, "far", 60_000)];
  const r = drillDownDashboard(traces, events, {});
  assert.equal(r.details[0].relatedEvents.length, 1);
  assert.equal(r.details[0].relatedEvents[0].event, "near");
});

test("A15: aggregates compute avg and p95 durations", () => {
  const traces = Array.from({ length: 20 }, (_, i) =>
    trace(i, { status: "success" })
  ).map((t, i) => ({ ...t, durationMs: (i + 1) * 100 }));
  const r = drillDownDashboard(traces, [], {});
  // durations 100..2000, avg = 1050
  assert.equal(r.aggregates.avgDurationMs, 1050);
  // p95 of 20 sorted = index ceil(0.95*20)-1 = 18 → 1900
  assert.equal(r.aggregates.p95DurationMs, 1900);
});

test("A15: limit truncates details but not aggregates", () => {
  const traces = Array.from({ length: 50 }, (_, i) => trace(i));
  const r = drillDownDashboard(traces, [], { limit: 5 });
  assert.equal(r.details.length, 5);
  assert.equal(r.aggregates.matchedTraces, 50);
});

test("A15: eventType filter narrows event aggregates", () => {
  const events = [event(0, "type_a", 0), event(0, "type_b", 100), event(0, "type_a", 200)];
  const r = drillDownDashboard([], events, { eventType: "type_a" });
  assert.equal(r.aggregates.matchedEvents, 2);
  assert.equal(r.aggregates.perEventType.length, 1);
  assert.equal(r.aggregates.perEventType[0].event, "type_a");
});
