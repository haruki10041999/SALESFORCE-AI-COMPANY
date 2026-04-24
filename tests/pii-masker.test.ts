import test from "node:test";
import assert from "node:assert/strict";
import { maskUnknown } from "../mcp/core/logging/pii-masker.js";

test("pii masker masks likely Salesforce IDs", () => {
  const source = {
    id: "001xx000003DGbYAAW",
    message: "recordId=001xx000003DGbYAAW"
  };

  const masked = maskUnknown(source) as { id: string; message: string };
  assert.equal(masked.id, "***");
  assert.match(masked.message, /\*\*\*/);
});

test("pii masker keeps non-sensitive keys readable", () => {
  const source = {
    errorAggregateDetected: {
      autoDisableTool: true,
      maxToolsPerRun: 3
    },
    eventName: "governance_threshold_exceeded"
  };

  const masked = maskUnknown(source) as {
    errorAggregateDetected: { autoDisableTool: boolean; maxToolsPerRun: number };
    eventName: string;
  };

  assert.equal(masked.errorAggregateDetected.autoDisableTool, true);
  assert.equal(masked.errorAggregateDetected.maxToolsPerRun, 3);
  assert.equal(masked.eventName, "governance_threshold_exceeded");
});
