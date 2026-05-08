import assert from "node:assert";
import { test } from "node:test";
import { resolveEnvMode, validateEnvironment } from "../../mcp/env-schema.js";

test("resolveEnvMode infers prod from operations profile", () => {
  const mode = resolveEnvMode({ SF_AI_PROFILE: "operations" } as NodeJS.ProcessEnv);
  assert.equal(mode, "prod");
});

test("validateEnvironment fails when postgres backend has no DATABASE_URL", () => {
  assert.throws(
    () =>
      validateEnvironment({
        SF_AI_STATE_BACKEND: "postgres",
      } as NodeJS.ProcessEnv),
    /DATABASE_URL/,
  );
});

test("validateEnvironment accepts postgres backend with DATABASE_URL", () => {
  const validated = validateEnvironment({
    SF_AI_STATE_BACKEND: "postgres",
    DATABASE_URL: "postgres://user:pass@localhost:5432/sfai",
  } as NodeJS.ProcessEnv);

  assert.equal(validated.mode, "dev");
  assert.equal(validated.data.SF_AI_STATE_BACKEND, "postgres");
});

test("validateEnvironment rejects unsupported enum values", () => {
  assert.throws(
    () =>
      validateEnvironment({
        SF_AI_SECRET_BACKEND: "invalid-backend",
      } as NodeJS.ProcessEnv),
    /SF_AI_SECRET_BACKEND/,
  );
});
