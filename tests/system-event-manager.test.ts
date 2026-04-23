import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSystemEventManager } from "../mcp/core/event/system-event-manager.js";

test("system-event-manager rotates logs and keeps archive count within limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "sf-ai-events-rotate-"));
  const outputsDir = join(root, "outputs");

  try {
    const manager = createSystemEventManager({
      rootDir: root,
      outputsDir,
      maxLogFileBytes: 300,
      maxArchivedFiles: 2,
      retentionDays: 365,
      ensureDir: async (dir: string) => {
        await mkdir(dir, { recursive: true });
      },
      applyEventAutomation: async () => undefined,
      bridgeCoreEvent: async () => undefined
    });

    for (let i = 0; i < 40; i++) {
      await manager.emitSystemEvent("tool_after_execute", {
        toolName: "tool-" + i,
        success: i % 2 === 0,
        note: "x".repeat(80)
      });
    }

    const eventDir = join(outputsDir, "events");
    const files = await readdir(eventDir);
    const archiveFiles = files.filter((name) => name !== "system-events.jsonl" && name.startsWith("system-events.") && name.endsWith(".jsonl"));

    assert.ok(files.includes("system-events.jsonl"), "active log should exist");
    assert.ok(archiveFiles.length >= 1, "at least one archive should be created");
    assert.ok(archiveFiles.length <= 2, "archive count should respect maxArchivedFiles");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("system-event-manager can load persisted events across rotated files", async () => {
  const root = await mkdtemp(join(tmpdir(), "sf-ai-events-load-"));
  const outputsDir = join(root, "outputs");

  try {
    const manager = createSystemEventManager({
      rootDir: root,
      outputsDir,
      maxLogFileBytes: 280,
      maxArchivedFiles: 50,
      retentionDays: 365,
      ensureDir: async (dir: string) => {
        await mkdir(dir, { recursive: true });
      },
      applyEventAutomation: async () => undefined,
      bridgeCoreEvent: async () => undefined
    });

    for (let i = 0; i < 20; i++) {
      await manager.emitSystemEvent("session_start", {
        index: i,
        topic: "topic-" + i,
        note: "y".repeat(70)
      });
    }

    const reloaded = createSystemEventManager({
      rootDir: root,
      outputsDir,
      maxLogFileBytes: 280,
      maxArchivedFiles: 50,
      retentionDays: 365,
      ensureDir: async (dir: string) => {
        await mkdir(dir, { recursive: true });
      },
      applyEventAutomation: async () => undefined,
      bridgeCoreEvent: async () => undefined
    });

    const loaded = await reloaded.loadSystemEvents(100, "session_start");
    assert.ok(loaded.length >= 20, "should read persisted events from rotated/current files");
    assert.ok(loaded.every((record) => record.event === "session_start"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
