import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OrchestrationSession } from "../mcp/core/types/index.js";
import { SqliteSessionStore } from "../mcp/core/persistence/session-store.sqlite.js";
import { runWithTenantContext } from "../mcp/core/identity/tenant-context.js";

function createSession(id: string): OrchestrationSession {
  return {
    id,
    topic: "tenant test",
    agents: ["architect"],
    persona: undefined,
    skills: [],
    filePaths: [],
    turns: 1,
    triggerRules: [],
    queue: ["architect"],
    history: [],
    firedRules: [],
    agentTrust: {}
  };
}

test("SqliteSessionStore isolates sessions by tenant_id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sfai-tenant-session-"));
  const dbPath = join(dir, "state.db");
  const store = SqliteSessionStore.open({ dbPath });

  try {
    await runWithTenantContext("tenant-a", async () => {
      const written = await store.upsert(createSession("sess-tenant"), -1);
      assert.equal(written.updated, true);
    });

    await runWithTenantContext("tenant-b", async () => {
      const loaded = await store.getById("sess-tenant");
      assert.equal(loaded, null);
      const listed = await store.list(10);
      assert.equal(listed.length, 0);
    });

    await runWithTenantContext("tenant-a", async () => {
      const loaded = await store.getById("sess-tenant");
      assert.ok(loaded);
      assert.equal(loaded?.id, "sess-tenant");
      const listed = await store.list(10);
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.id, "sess-tenant");
    });
  } finally {
    await store.close();
  }
});
