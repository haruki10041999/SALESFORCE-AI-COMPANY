import assert from "node:assert/strict";
import test from "node:test";

import { applyRuntimeProfile, resolveRuntimeProfile } from "../mcp/core/config/runtime-profile.js";

test("resolveRuntimeProfile maps known values", () => {
  assert.equal(resolveRuntimeProfile("local"), "local");
  assert.equal(resolveRuntimeProfile("operations"), "operations");
  assert.equal(resolveRuntimeProfile("unknown"), "custom");
  assert.equal(resolveRuntimeProfile(undefined), "custom");
});

test("applyRuntimeProfile enforces local preset in strict mode", () => {
  const env: NodeJS.ProcessEnv = {
    SF_AI_PROFILE: "local",
    SF_AI_PROFILE_STRICT: "true",
    SF_AI_STATE_BACKEND: "postgres",
    SF_AI_PROPOSAL_QUEUE_BACKEND: "pg-boss",
    SF_AI_VECTOR_BACKEND: "tfidf"
  };

  const result = applyRuntimeProfile(env);

  assert.equal(result.profile, "local");
  assert.equal(env.SF_AI_STATE_BACKEND, "sqlite");
  assert.equal(env.SF_AI_PROPOSAL_QUEUE_BACKEND, "file");
  assert.equal(env.SF_AI_VECTOR_BACKEND, "pgvector");
  assert.ok(result.overridden.includes("SF_AI_STATE_BACKEND"));
});

test("applyRuntimeProfile does not force override when strict=false", () => {
  const env: NodeJS.ProcessEnv = {
    SF_AI_PROFILE: "operations",
    SF_AI_PROFILE_STRICT: "false",
    SF_AI_STATE_BACKEND: "sqlite",
    SF_AI_PROPOSAL_QUEUE_BACKEND: "file",
    SF_AI_VECTOR_BACKEND: "tfidf"
  };

  const result = applyRuntimeProfile(env);

  assert.equal(result.profile, "operations");
  assert.equal(env.SF_AI_STATE_BACKEND, "sqlite");
  assert.equal(env.SF_AI_PROPOSAL_QUEUE_BACKEND, "file");
  assert.equal(env.SF_AI_VECTOR_BACKEND, "tfidf");
  assert.equal(result.changed.length, 0);
  assert.equal(result.overridden.length, 3);
});
