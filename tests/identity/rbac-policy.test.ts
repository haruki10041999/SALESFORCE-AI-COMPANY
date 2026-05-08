import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { authorize, loadRbacPolicy } from "../../mcp/core/identity/rbac.js";

test("loadRbacPolicy reads config/rbac/roles.yaml", async () => {
  const root = await mkdtemp(join(tmpdir(), "sfai-rbac-"));
  await mkdir(join(root, "config", "rbac"), { recursive: true });
  await writeFile(
    join(root, "config", "rbac", "roles.yaml"),
    JSON.stringify({
      version: "1.0",
      defaultRole: "viewer",
      rules: [
        { role: "viewer", resource: "tool:health_check", action: "execute", effect: "allow" },
        { role: "viewer", resource: "tool:get_system_events", action: "execute", effect: "deny" }
      ]
    }),
    "utf-8"
  );

  const policy = await loadRbacPolicy(root);
  const allowed = authorize(policy, "viewer", "execute", "tool:health_check");
  const denied = authorize(policy, "viewer", "execute", "tool:get_system_events");

  assert.equal(allowed.allowed, true);
  assert.equal(denied.allowed, false);
  assert.match(denied.reason ?? "", /Denied by RBAC policy/);
});

test("authorize denies when no allow rule matches", async () => {
  const policy = await loadRbacPolicy("non-existent-root-for-test");
  const result = authorize(policy, "viewer", "execute", "tool:unknown");

  assert.equal(result.allowed, false);
});
