import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";

import { getOutputsDirStartupWarnings } from "../mcp/core/config/outputs-dir-warning.js";

const ROOT = resolve("repo-root-test");

test("outputs dir warning reports default path when env is unset", () => {
  const warnings = getOutputsDirStartupWarnings({
    root: ROOT,
    resolvedOutputsDir: join(ROOT, "outputs")
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /not set/);
});

test("outputs dir warning reports relative env resolution", () => {
  const warnings = getOutputsDirStartupWarnings({
    root: ROOT,
    outputsDirEnv: "./tmp/outputs",
    resolvedOutputsDir: resolve("./tmp/outputs")
  });

  assert.ok(warnings.some((warning) => warning.includes("relative")));
});

test("outputs dir warning reports path outside project root", () => {
  const warnings = getOutputsDirStartupWarnings({
    root: ROOT,
    outputsDirEnv: "C:/shared/outputs",
    resolvedOutputsDir: resolve("C:/shared/outputs")
  });

  assert.ok(warnings.some((warning) => warning.includes("outside the project root")));
});
