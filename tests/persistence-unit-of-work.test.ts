import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileUnitOfWork } from "../mcp/core/persistence/unit-of-work.js";
import { SQLiteStateStore, isSqliteDriverAvailable } from "../mcp/core/persistence/sqlite-store.js";

test("file unit-of-work keeps staged writes invisible until commit", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-uow-file-test-"));
  const targetFile = join(root, "outputs", "history", "session.json");

  try {
    const unitOfWork = new FileUnitOfWork();
    await unitOfWork.stageFileWrite(targetFile, '{"ok":true}');

    assert.equal(existsSync(targetFile), false);

    await unitOfWork.commit();

    assert.equal(readFileSync(targetFile, "utf-8"), '{"ok":true}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("file unit-of-work rollback removes staged temp files without creating target", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-uow-file-rollback-test-"));
  const targetFile = join(root, "outputs", "history", "session.json");

  try {
    const unitOfWork = new FileUnitOfWork();
    await unitOfWork.stageFileWrite(targetFile, '{"ok":false}');

    await unitOfWork.rollback();

    assert.equal(existsSync(targetFile), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sqlite state store transaction rolls back on error", async (t) => {
  if (!isSqliteDriverAvailable()) {
    t.skip("sql.js runtime is not available");
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "sf-ai-uow-sqlite-test-"));
  const dbPath = join(root, "outputs", "state.sqlite");

  try {
    const store = await SQLiteStateStore.open({ dbPath });
    try {
      assert.throws(() => {
        store.executeInTransaction(() => {
          store.upsertHistorySession({
            id: "rollback-session",
            timestamp: "2026-04-27T12:00:00.000Z",
            topic: "rollback",
            agents: ["architect"],
            entries: []
          });
          throw new Error("force rollback");
        });
      }, /force rollback/);

      assert.equal(store.getHistorySessionById("rollback-session"), null);
    } finally {
      store.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});