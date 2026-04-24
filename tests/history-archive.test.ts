import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHistoryStore } from "../mcp/core/context/history-store.js";
import { archiveHistoryByDate } from "../scripts/archive-history.js";

function collectJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectJsonFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files;
}

test("history store saves chats under day-based directory and can restore", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-history-day-test-"));
  const historyDir = join(root, "outputs", "history");
  const agentLog = [
    {
      agent: "architect",
      message: "設計方針を確定します",
      timestamp: new Date().toISOString(),
      topic: "history-test"
    }
  ];

  try {
    const store = createHistoryStore({
      historyDir,
      ensureDir: async (dir: string) => {
        await import("node:fs").then((fs) => fs.promises.mkdir(dir, { recursive: true }));
      },
      agentLog,
      maxHistoryFiles: 20,
      retentionDays: 30
    });

    const id = await store.saveChatHistory("history-test");
    const day = id.slice(0, 10);
    const jsonFiles = collectJsonFiles(historyDir);
    assert.ok(jsonFiles.length >= 1);
    assert.ok(jsonFiles.some((filePath) => filePath.includes(`/${day}/`) || filePath.includes(`\\${day}\\`)));

    const loaded = await store.loadChatHistories();
    assert.ok(loaded.some((session) => session.id === id));

    const restored = await store.restoreChatHistory(id);
    assert.equal(restored?.id, id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("archiveHistoryByDate creates archive json and markdown summary", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-history-archive-test-"));
  const historyDir = join(root, "outputs", "history");
  const date = "2026-04-23";
  const dayDir = join(historyDir, date);

  try {
    await import("node:fs").then((fs) => fs.promises.mkdir(dayDir, { recursive: true }));

    const session = {
      id: `${date}-12-00-00`,
      timestamp: `${date}T12:00:00.000Z`,
      topic: "release readiness",
      agents: ["architect", "qa-engineer"],
      entries: [
        {
          agent: "architect",
          message: "結論: リリース可能です",
          timestamp: `${date}T12:00:00.000Z`
        },
        {
          agent: "qa-engineer",
          message: "次は回帰テスト結果を添付します",
          timestamp: `${date}T12:03:00.000Z`
        }
      ]
    };

    await import("node:fs").then((fs) =>
      fs.promises.writeFile(join(dayDir, `${session.id}.json`), JSON.stringify(session, null, 2), "utf-8")
    );

    const result = await archiveHistoryByDate(join(root, "outputs"), date);
    assert.equal(result.sessionCount, 1);
    assert.equal(existsSync(result.archiveJsonPath), true);
    assert.equal(existsSync(result.summaryMdPath), true);

    const summary = readFileSync(result.summaryMdPath, "utf-8");
    assert.ok(summary.includes("Daily Chat Summary"));
    assert.ok(summary.includes("release readiness"));
    assert.ok(summary.includes("Conclusion"));
    assert.ok(summary.includes("Next Actions"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
