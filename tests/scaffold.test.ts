import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { run } from "../scripts/scaffold.js";

test("scaffold preset writes setup artifact under configured outputs dir", async () => {
  const outputsDir = mkdtempSync(join(tmpdir(), "sf-ai-scaffold-preset-"));
  const prevOutputsDir = process.env.SF_AI_OUTPUTS_DIR;
  process.env.SF_AI_OUTPUTS_DIR = outputsDir;

  try {
    const exitCode = await run([
      "--non-interactive",
      "preset",
      "verification-sample",
      "--agents",
      "architect,qa-engineer",
      "--overwrite"
    ]);

    const filePath = join(outputsDir, "setup", "scaffold", "presets", "verification-sample.json");
    assert.equal(exitCode, 0);
    assert.equal(existsSync(filePath), true);

    const payload = JSON.parse(readFileSync(filePath, "utf-8")) as { agents: string[] };
    assert.deepEqual(payload.agents, ["architect", "qa-engineer"]);
  } finally {
    if (prevOutputsDir === undefined) {
      delete process.env.SF_AI_OUTPUTS_DIR;
    } else {
      process.env.SF_AI_OUTPUTS_DIR = prevOutputsDir;
    }
    rmSync(outputsDir, { recursive: true, force: true });
  }
});

test("scaffold tool writes setup artifact under configured outputs dir", async () => {
  const outputsDir = mkdtempSync(join(tmpdir(), "sf-ai-scaffold-tool-"));
  const prevOutputsDir = process.env.SF_AI_OUTPUTS_DIR;
  process.env.SF_AI_OUTPUTS_DIR = outputsDir;

  try {
    const exitCode = await run([
      "--non-interactive",
      "tool",
      "release-guard",
      "--description",
      "Release safety check",
      "--agents",
      "release-manager,qa-engineer",
      "--overwrite"
    ]);

    const filePath = join(outputsDir, "setup", "scaffold", "custom-tools", "release-guard.json");
    assert.equal(exitCode, 0);
    assert.equal(existsSync(filePath), true);

    const payload = JSON.parse(readFileSync(filePath, "utf-8")) as { description: string; agents: string[] };
    assert.equal(payload.description, "Release safety check");
    assert.deepEqual(payload.agents, ["release-manager", "qa-engineer"]);
  } finally {
    if (prevOutputsDir === undefined) {
      delete process.env.SF_AI_OUTPUTS_DIR;
    } else {
      process.env.SF_AI_OUTPUTS_DIR = prevOutputsDir;
    }
    rmSync(outputsDir, { recursive: true, force: true });
  }
});
