import assert from "node:assert/strict";
import test from "node:test";

import { isEnvFlagEnabled, parseBooleanEnv, parseBooleanLike } from "../mcp/core/config/env-flags.js";

test("parseBooleanEnv handles true/false aliases", () => {
  assert.equal(parseBooleanEnv("true", false), true);
  assert.equal(parseBooleanEnv("1", false), true);
  assert.equal(parseBooleanEnv("yes", false), true);
  assert.equal(parseBooleanEnv("on", false), true);

  assert.equal(parseBooleanEnv("false", true), false);
  assert.equal(parseBooleanEnv("0", true), false);
  assert.equal(parseBooleanEnv("no", true), false);
  assert.equal(parseBooleanEnv("off", true), false);
});

test("parseBooleanEnv falls back on unknown value", () => {
  assert.equal(parseBooleanEnv("maybe", true), true);
  assert.equal(parseBooleanEnv("maybe", false), false);
  assert.equal(parseBooleanEnv(undefined, true), true);
});

test("parseBooleanLike handles nullable and whitespace input", () => {
  assert.equal(parseBooleanLike("  true  ", false), true);
  assert.equal(parseBooleanLike(" off ", true), false);
  assert.equal(parseBooleanLike(null, true), true);
});

test("isEnvFlagEnabled reads from provided env object", () => {
  const env: NodeJS.ProcessEnv = {
    FEATURE_A: "true",
    FEATURE_B: "0"
  };

  assert.equal(isEnvFlagEnabled("FEATURE_A", env), true);
  assert.equal(isEnvFlagEnabled("FEATURE_B", env), false);
  assert.equal(isEnvFlagEnabled("FEATURE_C", env, true), true);
});
