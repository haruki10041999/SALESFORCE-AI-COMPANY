import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SQLiteStateStore, isSqliteDriverAvailable } from "../mcp/core/persistence/sqlite-store.js";
import { createHistoryStore } from "../mcp/core/context/history-store.js";

test("sqlite state store persists history and deduplicates jsonl rows", async (t) => {
  if (!isSqliteDriverAvailable()) {
    t.skip("node:sqlite runtime is not available");
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "sf-ai-sqlite-store-test-"));
  const dbPath = join(root, "outputs", "state.sqlite");

  try {
    const store = await SQLiteStateStore.open({ dbPath });
    try {
      store.upsertHistorySession({
        id: "s1",
        timestamp: "2026-04-27T12:00:00.000Z",
        topic: "topic-a",
        agents: ["architect"],
        entries: [{ agent: "architect", message: "ok", timestamp: "2026-04-27T12:00:00.000Z" }]
      });

      const insertedFirst = store.insertJsonlRecord({
        stream: "events.system-events",
        payload: '{"event":"x"}',
        sourcePath: "events/system-events.jsonl",
        lineNumber: 1
      });
      const insertedSecond = store.insertJsonlRecord({
        stream: "events.system-events",
        payload: '{"event":"x"}',
        sourcePath: "events/system-events.jsonl",
        lineNumber: 1
      });

      assert.equal(insertedFirst, true);
      assert.equal(insertedSecond, false);
      assert.equal(store.countHistorySessions(), 1);
      assert.equal(store.listJsonlRecords("events.system-events").length, 1);
    } finally {
      store.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("history store sqlite backend save/load/restore works", async (t) => {
  if (!isSqliteDriverAvailable()) {
    t.skip("node:sqlite runtime is not available");
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "sf-ai-history-sqlite-test-"));
  const historyDir = join(root, "outputs", "history");
  const dbPath = join(root, "outputs", "state.sqlite");
  const agentLog = [
    {
      agent: "architect",
      message: "sqlite mode",
      timestamp: new Date().toISOString(),
      topic: "sqlite-history"
    }
  ];

  try {
    const store = createHistoryStore({
      historyDir,
      ensureDir: async () => {
        // sqlite mode does not require history directory creation
      },
      agentLog,
      sqlite: { enabled: true, dbPath }
    });

    const id = await store.saveChatHistory("sqlite-history");
    const sessions = await store.loadChatHistories();
    assert.ok(sessions.some((s) => s.id === id));

    const restored = await store.restoreChatHistory(id);
    assert.equal(restored?.id, id);
    await store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
