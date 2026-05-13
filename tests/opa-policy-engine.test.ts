import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpaPolicyEngine } from "../mcp/core/governance/opa-policy-engine.js";

function makeServerRoot(): { serverRoot: string; cleanup: () => void } {
  const serverRoot = mkdtempSync(join(tmpdir(), "sf-ai-policy-engine-"));
  mkdirSync(join(serverRoot, "config", "policies"), { recursive: true });
  return {
    serverRoot,
    cleanup: () => rmSync(serverRoot, { recursive: true, force: true })
  };
}

test("opa policy engine denies matching rule", async () => {
  const paths = makeServerRoot();
  writeFileSync(
    join(paths.serverRoot, "config", "policies", "tool_access.json"),
    JSON.stringify({
      version: "1.0",
      defaultEffect: "allow",
      rules: [
        {
          id: "deny.viewer.apply_proposal",
          effect: "deny",
          tools: ["apply_proposal"],
          roles: ["viewer"]
        }
      ]
    }),
    "utf-8"
  );

  const engine = new OpaPolicyEngine({ serverRoot: paths.serverRoot });
  const decision = await engine.evaluate({
    policySet: "tool_access",
    toolName: "apply_proposal",
    actor: { id: "u-1", role: "viewer" },
    input: {}
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "deny.viewer.apply_proposal");
  paths.cleanup();
});

test("opa policy engine falls back to default allow when no file exists", async () => {
  const paths = makeServerRoot();
  const engine = new OpaPolicyEngine({ serverRoot: paths.serverRoot });
  const decision = await engine.evaluate({
    policySet: "tool_access",
    toolName: "health_check",
    actor: { id: "u-2", role: "viewer" },
    input: {}
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.ruleId, "default");
  paths.cleanup();
});
