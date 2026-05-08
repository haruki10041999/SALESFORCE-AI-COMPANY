import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OutputsArtifactWriter } from "../mcp/core/persistence/outputs-artifact-writer.js";

test("OutputsArtifactWriter appends jsonl without DB", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sfai-out-writer-"));
  const writer = new OutputsArtifactWriter({ outputsDir: dir });

  await writer.appendJsonl("reports/test.jsonl", { hello: "world" });
  await writer.appendJsonl("reports/test.jsonl", { n: 2 });

  const content = await readFile(join(dir, "reports", "test.jsonl"), "utf-8");
  const lines = content.trim().split("\n");

  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0] ?? "{}"), { hello: "world" });
  assert.deepEqual(JSON.parse(lines[1] ?? "{}"), { n: 2 });
});

test("OutputsArtifactWriter writes text and json artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sfai-out-writer-"));
  const writer = new OutputsArtifactWriter({ outputsDir: dir });

  await writer.writeText("dashboards/sample.md", "# hello\n");
  await writer.writeJson("dashboards/sample.json", { ok: true, n: 1 });

  const markdown = await readFile(join(dir, "dashboards", "sample.md"), "utf-8");
  const json = await readFile(join(dir, "dashboards", "sample.json"), "utf-8");

  assert.equal(markdown, "# hello\n");
  assert.deepEqual(JSON.parse(json), { ok: true, n: 1 });
});

test("OutputsArtifactWriter blocks state-like output paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sfai-out-writer-"));
  const writer = new OutputsArtifactWriter({ outputsDir: dir });

  await assert.rejects(async () => {
    await writer.appendJsonl("audit/blocked.jsonl", { blocked: true });
  }, /outputs state write is prohibited/);

  await assert.rejects(async () => {
    await writer.writeJson("trigger-rules.json", { blocked: true });
  }, /outputs state write is prohibited/);
});
