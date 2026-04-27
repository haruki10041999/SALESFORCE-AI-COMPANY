import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendExecutionOrigin, buildExecutionOriginRecord } from "../mcp/core/governance/outputs-origin.js";

function createTempRoot(prefix: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

test("buildExecutionOriginRecord detects repo roots from repoPath and filePaths", () => {
  const fixture = createTempRoot("outputs-origin-" );
  try {
    const repoRoot = join(fixture.root, "client-repo");
    const nestedFile = join(repoRoot, "force-app", "main", "default", "classes", "Account.cls");
    mkdirSync(join(repoRoot, ".git"), { recursive: true });
    mkdirSync(join(nestedFile, ".."), { recursive: true });
    writeFileSync(nestedFile, "public class Account {}\n", "utf-8");

    const record = buildExecutionOriginRecord(
      "repo_analyze",
      { repoPath: repoRoot, filePaths: [nestedFile] },
      "success",
      fixture.root
    );

    assert.equal(record.toolName, "repo_analyze");
    assert.equal(record.status, "success");
    assert.ok(record.repoRoots.includes(fixture.root));
    assert.ok(record.repoRoots.includes(repoRoot));
    assert.ok(record.inputPathHints.includes(repoRoot));
    assert.ok(record.inputPathHints.includes(nestedFile));
  } finally {
    fixture.cleanup();
  }
});

test("appendExecutionOrigin writes JSONL record under outputs", () => {
  const fixture = createTempRoot("outputs-origin-write-");
  try {
    const outputsDir = join(fixture.root, "outputs");
    appendExecutionOrigin(outputsDir, {
      timestamp: "2026-04-27T00:00:00.000Z",
      toolName: "chat",
      status: "success",
      serverRoot: fixture.root,
      processCwd: fixture.root,
      repoRoots: [fixture.root],
      inputPathHints: []
    });

    const raw = readFileSync(join(outputsDir, "execution-origins.jsonl"), "utf-8").trim();
    const parsed = JSON.parse(raw) as { toolName: string; repoRoots: string[] };

    assert.equal(parsed.toolName, "chat");
    assert.deepEqual(parsed.repoRoots, [fixture.root]);
  } finally {
    fixture.cleanup();
  }
});