import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  enumerateFlowConditionMatrix,
  extractFlowConditionFields,
  type FlowConditionNode
} from "../mcp/tools/flow-condition-simulator.js";

const cond: FlowConditionNode = {
  op: "all",
  conditions: [
    { op: "eq", field: "Status", value: "Active" },
    { op: "gte", field: "Amount", value: 100 }
  ]
};

test("extractFlowConditionFields lists fields used in expression", () => {
  const fields = extractFlowConditionFields(cond);
  assert.deepEqual(fields, ["Amount", "Status"]);
});

test("enumerateFlowConditionMatrix evaluates the full cartesian product", () => {
  const summary = enumerateFlowConditionMatrix(cond, {
    fieldDomains: {
      Status: ["Active", "Inactive"],
      Amount: [50, 100, 200]
    }
  });
  assert.equal(summary.totalEvaluated, 6);
  // Active かつ Amount>=100 → 2 通り (100, 200) のみ true
  assert.equal(summary.triggerTrueCount, 2);
  assert.equal(summary.truncated, false);
});

test("enumerateFlowConditionMatrix truncates when exceeding maxCombinations", () => {
  const summary = enumerateFlowConditionMatrix(cond, {
    fieldDomains: {
      Status: ["Active", "Inactive"],
      Amount: Array.from({ length: 100 }, (_, i) => i)
    },
    maxCombinations: 50
  });
  assert.equal(summary.totalEvaluated, 50);
  assert.equal(summary.truncated, true);
});
