import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createOrchestrationSessionStore } from "../mcp/core/context/orchestration-session-store.js";
import { loadOrgCatalog, saveOrgCatalog } from "../mcp/core/org/org-catalog-store.js";

test("org catalog store saves and loads catalog via atomic write", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-org-catalog-test-"));
  const filePath = join(root, "outputs", "orgs", "catalog.json");

  try {
    await saveOrgCatalog(filePath, {
      version: 1,
      updatedAt: "2026-04-27T00:00:00.000Z",
      orgs: [
        {
          alias: "devhub",
          instanceUrl: "https://example.my.salesforce.com",
          type: "sandbox",
          registeredAt: "2026-04-27T00:00:00.000Z",
          lastSeenAt: "2026-04-27T00:00:00.000Z"
        }
      ]
    });

    const loaded = await loadOrgCatalog(filePath);
    assert.equal(loaded.orgs.length, 1);
    assert.equal(loaded.orgs[0]?.alias, "devhub");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("orchestration session store saves and restores session via atomic write", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-orch-session-test-"));
  const sessionsDir = join(root, "outputs", "sessions");
  const session = {
    id: "orch-2026-04-27T000000000Z",
    history: [{ role: "agent", message: "hello" }]
  };
  const registry = new Map([[session.id, session]]);

  try {
    const store = createOrchestrationSessionStore({
      sessionsDir,
      ensureDir: async (dir) => {
        await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
      },
      getSession: (sessionId) => registry.get(sessionId),
      setSession: (value) => {
        registry.set(value.id, value);
      },
      toRelativePosixPath: (absolutePath) => absolutePath.replace(/\\/g, "/")
    });

    const saved = await store.saveOrchestrationSession(session.id);
    assert.ok(saved);

    const raw = JSON.parse(readFileSync(join(sessionsDir, session.id + ".json"), "utf-8")) as { id: string };
    assert.equal(raw.id, session.id);

    registry.clear();
    const restored = await store.restoreOrchestrationSession(session.id);
    assert.equal(restored?.id, session.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});