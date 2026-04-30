import test from "node:test";
import assert from "node:assert/strict";

import { evaluateExecutionPolicy, type ExecutionPolicy } from "../mcp/core/governance/execution-policy.js";

const policy: ExecutionPolicy = {
  version: "1.0",
  blockedTools: ["danger_*"],
  dangerousActions: {
    denyForNonAdmin: true,
    resourceActions: ["delete", "disable"]
  }
};

test("execution policy blocks configured tool patterns", () => {
  const result = evaluateExecutionPolicy({
    policy,
    toolName: "danger_wipe",
    role: "admin",
    input: {}
  });

  assert.equal(result.allowed, false);
  assert.equal(result.rule, "blocked-tool");
});

test("execution policy blocks dangerous apply_resource_actions for non-admin", () => {
  const result = evaluateExecutionPolicy({
    policy,
    toolName: "apply_resource_actions",
    role: "operator",
    input: {
      actions: [
        { resourceType: "skills", action: "delete", name: "x" }
      ]
    }
  });

  assert.equal(result.allowed, false);
  assert.equal(result.rule, "dangerous-resource-action");
});

test("execution policy allows dangerous action for admin", () => {
  const result = evaluateExecutionPolicy({
    policy,
    toolName: "apply_resource_actions",
    role: "admin",
    input: {
      actions: [
        { resourceType: "skills", action: "delete", name: "x" }
      ]
    }
  });

  assert.equal(result.allowed, true);
});
