import { isEnvFlagEnabled } from "../config/env-flags.js";
import { parsePositiveIntOrFallback } from "../config/numeric-parsing.js";
import { createDbClient } from "../../../db/client.js";
import { PostgresQuotaStore } from "./postgres-quota-store.js";

type RateLimitScope = "actor" | "tenant" | "tool";
type RateLimitBackend = "in-memory" | "postgres";
type MaybePromise<T> = T | Promise<T>;

export interface RateLimitConfig {
  enabled: boolean;
  backend: RateLimitBackend;
  windowMs: number;
  actorLimit: number;
  tenantLimit: number;
  toolLimit: number;
  maxKeys: number;
}

export interface ToolRateLimitContext {
  actorId: string;
  tenantId: string;
  toolName: string;
  nowMs?: number;
}

export interface ToolRateLimitResult {
  allowed: boolean;
  scope?: RateLimitScope;
  key?: string;
  limit?: number;
  remaining?: number;
  retryAfterMs?: number;
}

export interface ToolRateLimiter {
  check(input: ToolRateLimitContext): MaybePromise<ToolRateLimitResult>;
}

interface CounterWindow {
  count: number;
  windowStart: number;
}

interface ScopeDecision {
  allowed: boolean;
  key: string;
  limit: number;
  remaining: number;
  retryAfterMs: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_ACTOR_LIMIT = 120;
const DEFAULT_TENANT_LIMIT = 600;
const DEFAULT_TOOL_LIMIT = 300;
const DEFAULT_MAX_KEYS = 10_000;
const DEFAULT_BACKEND: RateLimitBackend = "in-memory";

class FixedWindowCounter {
  private readonly windows = new Map<string, CounterWindow>();

  public constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys: number
  ) {}

  public hit(key: string, nowMs: number): ScopeDecision {
    this.pruneIfNeeded(nowMs);
    const current = this.windows.get(key);
    if (!current || nowMs - current.windowStart >= this.windowMs) {
      this.windows.set(key, { count: 1, windowStart: nowMs });
      return {
        allowed: true,
        key,
        limit: this.limit,
        remaining: Math.max(0, this.limit - 1),
        retryAfterMs: this.windowMs
      };
    }

    if (current.count >= this.limit) {
      const retryAfterMs = Math.max(1, current.windowStart + this.windowMs - nowMs);
      return {
        allowed: false,
        key,
        limit: this.limit,
        remaining: 0,
        retryAfterMs
      };
    }

    current.count += 1;
    return {
      allowed: true,
      key,
      limit: this.limit,
      remaining: Math.max(0, this.limit - current.count),
      retryAfterMs: Math.max(1, current.windowStart + this.windowMs - nowMs)
    };
  }

  private pruneIfNeeded(nowMs: number): void {
    if (this.windows.size <= this.maxKeys) {
      return;
    }
    for (const [key, entry] of this.windows) {
      if (nowMs - entry.windowStart >= this.windowMs * 2) {
        this.windows.delete(key);
      }
      if (this.windows.size <= this.maxKeys) {
        break;
      }
    }
  }
}

export class NoopToolRateLimiter implements ToolRateLimiter {
  public check(_input: ToolRateLimitContext): ToolRateLimitResult {
    return { allowed: true };
  }
}

export class InMemoryToolRateLimiter implements ToolRateLimiter {
  private readonly actorCounter: FixedWindowCounter;
  private readonly tenantCounter: FixedWindowCounter;
  private readonly toolCounter: FixedWindowCounter;

  public constructor(private readonly config: RateLimitConfig) {
    this.actorCounter = new FixedWindowCounter(config.actorLimit, config.windowMs, config.maxKeys);
    this.tenantCounter = new FixedWindowCounter(config.tenantLimit, config.windowMs, config.maxKeys);
    this.toolCounter = new FixedWindowCounter(config.toolLimit, config.windowMs, config.maxKeys);
  }

  public check(input: ToolRateLimitContext): ToolRateLimitResult {
    if (!this.config.enabled) {
      return { allowed: true };
    }
    const nowMs = input.nowMs ?? Date.now();

    const actorDecision = this.actorCounter.hit(input.actorId, nowMs);
    if (!actorDecision.allowed) {
      return {
        allowed: false,
        scope: "actor",
        key: actorDecision.key,
        limit: actorDecision.limit,
        remaining: actorDecision.remaining,
        retryAfterMs: actorDecision.retryAfterMs
      };
    }

    const tenantDecision = this.tenantCounter.hit(input.tenantId, nowMs);
    if (!tenantDecision.allowed) {
      return {
        allowed: false,
        scope: "tenant",
        key: tenantDecision.key,
        limit: tenantDecision.limit,
        remaining: tenantDecision.remaining,
        retryAfterMs: tenantDecision.retryAfterMs
      };
    }

    const toolDecision = this.toolCounter.hit(input.toolName, nowMs);
    if (!toolDecision.allowed) {
      return {
        allowed: false,
        scope: "tool",
        key: toolDecision.key,
        limit: toolDecision.limit,
        remaining: toolDecision.remaining,
        retryAfterMs: toolDecision.retryAfterMs
      };
    }

    return {
      allowed: true,
      remaining: Math.min(actorDecision.remaining, tenantDecision.remaining, toolDecision.remaining)
    };
  }
}

export class PostgresToolRateLimiter implements ToolRateLimiter {
  private readonly actorCounter: FixedWindowCounter;
  private readonly toolCounter: FixedWindowCounter;

  public constructor(
    private readonly config: RateLimitConfig,
    private readonly quotaStore: PostgresQuotaStore
  ) {
    this.actorCounter = new FixedWindowCounter(config.actorLimit, config.windowMs, config.maxKeys);
    this.toolCounter = new FixedWindowCounter(config.toolLimit, config.windowMs, config.maxKeys);
  }

  public async check(input: ToolRateLimitContext): Promise<ToolRateLimitResult> {
    if (!this.config.enabled) {
      return { allowed: true };
    }
    const nowMs = input.nowMs ?? Date.now();

    const actorDecision = this.actorCounter.hit(input.actorId, nowMs);
    if (!actorDecision.allowed) {
      return {
        allowed: false,
        scope: "actor",
        key: actorDecision.key,
        limit: actorDecision.limit,
        remaining: actorDecision.remaining,
        retryAfterMs: actorDecision.retryAfterMs
      };
    }

    const toolDecision = this.toolCounter.hit(input.toolName, nowMs);
    if (!toolDecision.allowed) {
      return {
        allowed: false,
        scope: "tool",
        key: toolDecision.key,
        limit: toolDecision.limit,
        remaining: toolDecision.remaining,
        retryAfterMs: toolDecision.retryAfterMs
      };
    }

    const tenantDecision = await this.quotaStore.allow({
      tenantId: input.tenantId,
      toolName: input.toolName,
      limit: this.config.tenantLimit,
      nowMs,
      windowMs: this.config.windowMs
    });

    if (!tenantDecision.allowed) {
      return {
        allowed: false,
        scope: "tenant",
        key: `${input.tenantId}:${input.toolName}`,
        limit: this.config.tenantLimit,
        remaining: tenantDecision.remaining,
        retryAfterMs: tenantDecision.retryAfterMs
      };
    }

    return {
      allowed: true,
      remaining: Math.min(actorDecision.remaining, toolDecision.remaining, tenantDecision.remaining)
    };
  }
}

function parseRateLimitBackend(value: string | undefined): RateLimitBackend {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "postgres" ? "postgres" : DEFAULT_BACKEND;
}

export function buildRateLimitConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  return {
    enabled: isEnvFlagEnabled("SF_AI_RATE_LIMIT_ENABLED", env, true),
    backend: parseRateLimitBackend(env.SF_AI_RATE_LIMIT_BACKEND),
    windowMs: parsePositiveIntOrFallback(env.SF_AI_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
    actorLimit: parsePositiveIntOrFallback(env.SF_AI_RATE_LIMIT_ACTOR_MAX, DEFAULT_ACTOR_LIMIT),
    tenantLimit: parsePositiveIntOrFallback(env.SF_AI_RATE_LIMIT_TENANT_MAX, DEFAULT_TENANT_LIMIT),
    toolLimit: parsePositiveIntOrFallback(env.SF_AI_RATE_LIMIT_TOOL_MAX, DEFAULT_TOOL_LIMIT),
    maxKeys: parsePositiveIntOrFallback(env.SF_AI_RATE_LIMIT_MAX_KEYS, DEFAULT_MAX_KEYS)
  };
}

let globalToolRateLimiter: ToolRateLimiter | null = null;

export function getGlobalToolRateLimiter(): ToolRateLimiter {
  if (!globalToolRateLimiter) {
    const config = buildRateLimitConfigFromEnv();
    if (!config.enabled) {
      globalToolRateLimiter = new NoopToolRateLimiter();
      return globalToolRateLimiter;
    }
    if (config.backend === "postgres") {
      try {
        const dbClient = createDbClient();
        globalToolRateLimiter = new PostgresToolRateLimiter(config, new PostgresQuotaStore({ dbClient }));
      } catch {
        globalToolRateLimiter = new InMemoryToolRateLimiter(config);
      }
      return globalToolRateLimiter;
    }
    globalToolRateLimiter = new InMemoryToolRateLimiter(config);
  }
  return globalToolRateLimiter;
}

export function setGlobalToolRateLimiter(rateLimiter: ToolRateLimiter | null): void {
  globalToolRateLimiter = rateLimiter;
}
