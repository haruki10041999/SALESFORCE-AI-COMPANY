import test from "node:test";
import assert from "node:assert/strict";
import { getFileExtension, unique, validateRef } from "../mcp/tools/git-diff-helpers.js";

test("validateRef accepts safe git refs", () => {
  assert.doesNotThrow(() => validateRef("main", "baseRef"));
  assert.doesNotThrow(() => validateRef("feature/test-branch", "workingRef"));
});

test("validateRef rejects unsafe refs", () => {
  assert.throws(() => validateRef("", "baseRef"));
  assert.throws(() => validateRef("-bad", "baseRef"));
  assert.throws(() => validateRef("bad ref", "baseRef"));
});

test("getFileExtension and unique helpers return expected values", () => {
  assert.equal(getFileExtension("force-app/main/default/classes/OrderService.cls"), "cls");
  assert.equal(getFileExtension("README"), "(no-ext)");
  assert.deepEqual(unique(["a", "b", "a", "c", "b"]), ["a", "b", "c"]);
});
