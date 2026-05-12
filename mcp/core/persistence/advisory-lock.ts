import { Pool } from "pg";
import { getOrCreatePgPool, releasePgPoolKey } from "./pg-pool-registry.js";

export interface AdvisoryLockOptions {
  databaseUrl?: string;
  lockNamespace?: string;
}

export interface WithLockOptions {
  timeoutMs?: number;
}

/**
 * Postgres advisory-lock helper.
 *
 * - key is normalized as `${namespace}:${key}`
 * - lock id uses hashtext(key)::bigint
 * - when DATABASE_URL is not set, this becomes a no-op lock (for local sqlite mode)
 */
export class AdvisoryLockManager {
  private readonly pool: Pool | null;
  private readonly poolKey: string | null;
  private readonly lockNamespace: string;

  private constructor(pool: Pool | null, poolKey: string | null, lockNamespace: string) {
    this.pool = pool;
    this.poolKey = poolKey;
    this.lockNamespace = lockNamespace;
  }

  public static open(options: AdvisoryLockOptions): AdvisoryLockManager {
    const namespace = options.lockNamespace?.trim() || "sfai";
    if (!options.databaseUrl || options.databaseUrl.trim().length === 0) {
      return new AdvisoryLockManager(null, null, namespace);
    }
    const normalizedUrl = options.databaseUrl.trim();
    const poolKey = `advisory-lock:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    return new AdvisoryLockManager(getOrCreatePgPool(poolKey, normalizedUrl), poolKey, namespace);
  }

  public async close(): Promise<void> {
    if (!this.poolKey) {
      return;
    }
    await releasePgPoolKey(this.poolKey);
  }

  public async withLock<T>(
    key: string,
    operation: () => Promise<T>,
    options?: WithLockOptions
  ): Promise<T> {
    if (!this.pool) {
      return operation();
    }

    const timeoutMs = Math.max(100, options?.timeoutMs ?? 5000);
    const lockKey = `${this.lockNamespace}:${key}`;
    const client = await this.pool.connect();
    const startedAt = Date.now();

    try {
      while (true) {
        const lockResult = await client.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired",
          [lockKey]
        );
        if (lockResult.rows[0]?.acquired === true) {
          break;
        }
        if (Date.now() - startedAt > timeoutMs) {
          throw new Error(`advisory lock timeout: ${lockKey}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      return await operation();
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [lockKey]);
      } finally {
        client.release();
      }
    }
  }
}
