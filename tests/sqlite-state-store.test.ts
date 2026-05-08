import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

test("sqlite state store can persist encrypted payload columns when enabled", async (t) => {
  if (!isSqliteDriverAvailable()) {
    t.skip("node:sqlite runtime is not available");
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "sf-ai-sqlite-store-encrypted-test-"));
  const dbPath = join(root, "outputs", "state.sqlite");
  const prevEnabled = process.env.SF_AI_ENCRYPTION_ENABLED;
  const prevKey = process.env.SF_AI_ENCRYPTION_KEY_B64;
  const prevKeyId = process.env.SF_AI_ENCRYPTION_KEY_ID;
  const keyB64 = Buffer.from("0123456789abcdef0123456789abcdef", "utf-8").toString("base64");

  try {
    process.env.SF_AI_ENCRYPTION_ENABLED = "true";
    process.env.SF_AI_ENCRYPTION_KEY_B64 = keyB64;
    process.env.SF_AI_ENCRYPTION_KEY_ID = "test-sqlite-v1";

    const store = await SQLiteStateStore.open({ dbPath });
    try {
      store.upsertGovernanceStateRow(JSON.stringify({ secure: "value" }), "2026-05-08T00:00:00.000Z");
      store.upsertHistorySession({
        id: "enc-session",
        timestamp: "2026-05-08T00:00:00.000Z",
        topic: "encrypted",
        agents: ["architect"],
        entries: [{ message: "secret-entry" }]
      });
      store.insertJsonlRecord({
        stream: "events.system-events",
        payload: '{"secret":"payload"}',
        sourcePath: "events/system-events.jsonl",
        lineNumber: 9
      });

      const governance = store.getGovernanceStateRow();
      assert.equal(governance?.stateJson, JSON.stringify({ secure: "value" }));
      assert.equal(store.getHistorySessionById("enc-session")?.entries.length, 1);
      assert.equal(store.listJsonlRecords("events.system-events")[0]?.payload, '{"secret":"payload"}');
    } finally {
      store.close();
    }

    const db = new DatabaseSync(dbPath);
    try {
      const gov = db.prepare("SELECT state_json FROM governance_state WHERE id = 1").get() as { state_json?: string };
      const hist = db.prepare("SELECT entries_json FROM history_sessions WHERE id = ?").get("enc-session") as { entries_json?: string };
      const jsonl = db.prepare("SELECT payload FROM jsonl_records WHERE stream = ?").get("events.system-events") as { payload?: string };
      assert.equal((gov.state_json ?? "").includes("secure"), false);
      assert.equal((hist.entries_json ?? "").includes("secret-entry"), false);
      assert.equal((jsonl.payload ?? "").includes("secret"), false);
    } finally {
      db.close();
    }
  } finally {
    if (typeof prevEnabled === "string") {
      process.env.SF_AI_ENCRYPTION_ENABLED = prevEnabled;
    } else {
      delete process.env.SF_AI_ENCRYPTION_ENABLED;
    }
    if (typeof prevKey === "string") {
      process.env.SF_AI_ENCRYPTION_KEY_B64 = prevKey;
    } else {
      delete process.env.SF_AI_ENCRYPTION_KEY_B64;
    }
    if (typeof prevKeyId === "string") {
      process.env.SF_AI_ENCRYPTION_KEY_ID = prevKeyId;
    } else {
      delete process.env.SF_AI_ENCRYPTION_KEY_ID;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
