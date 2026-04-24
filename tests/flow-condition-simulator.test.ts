import test from "node:test";
import assert from "node:assert/strict";
import { simulateFlowCondition } from "../mcp/tools/flow-condition-simulator.js";

test("simulateFlowCondition returns shouldTrigger=true when all conditions match", () => {
  const result = simulateFlowCondition({
    flowName: "CaseEscalationFlow",
    record: {
      Status: "New",
      Priority: "High",
      Account: {
        Tier: "Enterprise"
      }
    },
    condition: {
      op: "all",
      conditions: [
        { op: "eq", field: "Status", value: "New" },
        {
          op: "any",
          conditions: [
            { op: "eq", field: "Priority", value: "High" },
            { op: "eq", field: "Account.Tier", value: "Enterprise" }
          ]
        }
      ]
    }
  });

  assert.equal(result.shouldTrigger, true);
  assert.equal(result.unmetConditions.length, 0);
});

test("simulateFlowCondition returns shouldTrigger=false and unmet conditions", () => {
  const result = simulateFlowCondition({
    flowName: "CaseEscalationFlow",
    record: {
      Status: "Closed",
      Priority: "Low"
    },
    condition: {
      op: "all",
      conditions: [
        { op: "eq", field: "Status", value: "New" },
        { op: "eq", field: "Priority", value: "High" }
      ]
    }
  });

  assert.equal(result.shouldTrigger, false);
  assert.ok(result.unmetConditions.length >= 1);
});
