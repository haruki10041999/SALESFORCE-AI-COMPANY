import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRateLimitConfigFromEnv,
  InMemoryToolRateLimiter,
  type RateLimitConfig
} from "../../mcp/core/reliability/rate-limiter.js";

const TEST_CONFIG: RateLimitConfig = {
  enabled: true,
  windowMs: 1_000,
  actorLimit: 2,
  tenantLimit: 3,
  toolLimit: 4,
  maxKeys: 100
};

test("rate limiter blocks actor scope after threshold", () => {
  const limiter = new InMemoryToolRateLimiter(TEST_CONFIG);
  const base = 1_700_000_000_000;

  const first = limiter.check({ actorId: "a1", tenantId: "t1", toolName: "tool-x", nowMs: base });
  const second = limiter.check({ actorId: "a1", tenantId: "t1", toolName: "tool-x", nowMs: base + 1 });
  const third = limiter.check({ actorId: "a1", tenantId: "t1", toolName: "tool-x", nowMs: base + 2 });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.scope, "actor");
  assert.ok((third.retryAfterMs ?? 0) > 0);
});

test("rate limiter resets after window elapsed", () => {
  const limiter = new InMemoryToolRateLimiter(TEST_CONFIG);
  const base = 1_700_000_100_000;

  limiter.check({ actorId: "a2", tenantId: "t1", toolName: "tool-x", nowMs: base });
  limiter.check({ actorId: "a2", tenantId: "t1", toolName: "tool-x", nowMs: base + 2 });
  const blocked = limiter.check({ actorId: "a2", tenantId: "t1", toolName: "tool-x", nowMs: base + 3 });
  assert.equal(blocked.allowed, false);

  const allowedAfterWindow = limiter.check({
    actorId: "a2",
    tenantId: "t1",
    toolName: "tool-x",
    nowMs: base + TEST_CONFIG.windowMs + 5
  });
  assert.equal(allowedAfterWindow.allowed, true);
});

test("rate limiter can block tenant scope independently", () => {
  const limiter = new InMemoryToolRateLimiter({
    enabled: true,
    windowMs: 1_000,
    actorLimit: 100,
    tenantLimit: 2,
    toolLimit: 100,
    maxKeys: 100
  });
  const base = 1_700_000_200_000;

  limiter.check({ actorId: "a1", tenantId: "tenant-a", toolName: "tool-1", nowMs: base });
  limiter.check({ actorId: "a2", tenantId: "tenant-a", toolName: "tool-2", nowMs: base + 1 });
  const blocked = limiter.check({ actorId: "a3", tenantId: "tenant-a", toolName: "tool-3", nowMs: base + 2 });

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.scope, "tenant");
});

test("rate limiter can block tool scope independently", () => {
  const limiter = new InMemoryToolRateLimiter({
    enabled: true,
    windowMs: 1_000,
    actorLimit: 100,
    tenantLimit: 100,
    toolLimit: 2,
    maxKeys: 100
  });
  const base = 1_700_000_300_000;

  limiter.check({ actorId: "a1", tenantId: "t1", toolName: "hot-tool", nowMs: base });
  limiter.check({ actorId: "a2", tenantId: "t2", toolName: "hot-tool", nowMs: base + 1 });
  const blocked = limiter.check({ actorId: "a3", tenantId: "t3", toolName: "hot-tool", nowMs: base + 2 });

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.scope, "tool");
});

test("rate limit config uses defaults when env is missing", () => {
  const config = buildRateLimitConfigFromEnv({});
  assert.deepEqual(config, {
    enabled: true,
    windowMs: 60_000,
    actorLimit: 120,
    tenantLimit: 600,
    toolLimit: 300,
    maxKeys: 10_000
  });
});

test("rate limit config reads env overrides", () => {
  const config = buildRateLimitConfigFromEnv({
    SF_AI_RATE_LIMIT_ENABLED: "false",
    SF_AI_RATE_LIMIT_WINDOW_MS: "5000",
    SF_AI_RATE_LIMIT_ACTOR_MAX: "11",
    SF_AI_RATE_LIMIT_TENANT_MAX: "22",
    SF_AI_RATE_LIMIT_TOOL_MAX: "33",
    SF_AI_RATE_LIMIT_MAX_KEYS: "444"
  });
  assert.deepEqual(config, {
    enabled: false,
    windowMs: 5000,
    actorLimit: 11,
    tenantLimit: 22,
    toolLimit: 33,
    maxKeys: 444
  });
});
