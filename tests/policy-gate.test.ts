import test from "node:test";
import assert from "node:assert/strict";
import { createPolicyGate } from "../mcp/core/governance/policy-gate.js";

test("policy gate blocks dangerous action with saga hint when required", async () => {
  const gate = createPolicyGate();

  const result = await gate.check("remove_org", {
    orgId: "org-1"
  });

  assert.equal(result.blocked, true);
  if (!result.blocked) {
    throw new Error("expected blocked result");
  }

  assert.equal(result.entry.actionType, "delete");
  assert.equal(result.entry.requiresSaga, true);
  assert.equal(result.proposalHint.executionMode, "saga");
  assert.match(result.message, /Saga\/compensation workflow/);

  const parsed = JSON.parse(result.proposalHint.content) as { requiresSaga?: boolean };
  assert.equal(parsed.requiresSaga, true);
});

test("policy gate blocks dangerous action without saga hint when not required", async () => {
  const gate = createPolicyGate();

  const result = await gate.check("list_orchestration_sessions", {});

  assert.equal(result.blocked, false);
});
