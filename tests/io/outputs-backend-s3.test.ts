import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveOutputsBackend, writeOutputsArtifact } from "../../mcp/core/io/outputs-backend-s3.js";

test("resolveOutputsBackend defaults to fs", () => {
  delete process.env.OUTPUTS_BACKEND;
  delete process.env.SF_AI_OUTPUTS_BACKEND;

  assert.equal(resolveOutputsBackend(), "fs");
});

test("writeOutputsArtifact writes to filesystem backend", async () => {
  const root = mkdtempSync(join(tmpdir(), "outputs-backend-test-"));
  process.env.OUTPUTS_BACKEND = "fs";
  process.env.SF_AI_OUTPUTS_DIR = root;

  const result = await writeOutputsArtifact("reports/t33-check.json", "{\"ok\":true}\n", {
    contentType: "application/json"
  });

  assert.equal(result.backend, "fs");
  assert.ok(existsSync(result.location));
  assert.equal(readFileSync(result.location, "utf-8"), "{\"ok\":true}\n");
});
