import type { Pool, PoolClient } from "pg";
import { getOrCreatePgPool, releasePgPoolKey } from "../persistence/pg-pool-registry.js";

export interface LeaderElectionOptions {
  databaseUrl?: string;
  lockNamespace?: string;
  enabled?: boolean;
  instanceId?: string;
}

export interface RunIfLeaderParams<T> {
  lockKey: string;
  onLeader: () => Promise<T>;
  onFollower?: () => Promise<T>;
}

/**
 * TASK-16 (Phase4) minimal leader-election helper.
 *
 * Uses Postgres advisory lock (`pg_try_advisory_lock`) as a leader gate
 * for duplicate-prone operations (cron/bootstrap sync, maintenance jobs).
 */
export class LeaderElection {
  private readonly pool: Pool | null;
  private readonly poolKey: string | null;
  private readonly lockNamespace: string;
  private readonly enabled: boolean;
  private readonly instanceId: string;

  private constructor(params: {
    pool: Pool | null;
    poolKey: string | null;
    lockNamespace: string;
    enabled: boolean;
    instanceId: string;
  }) {
    this.pool = params.pool;
    this.poolKey = params.poolKey;
    this.lockNamespace = params.lockNamespace;
    this.enabled = params.enabled;
    this.instanceId = params.instanceId;
  }

  public static open(options: LeaderElectionOptions): LeaderElection {
    const lockNamespace = options.lockNamespace?.trim() || "sfai:leader";
    const enabled = options.enabled ?? true;
    const instanceId = options.instanceId?.trim() || process.pid.toString();

    if (!enabled || !options.databaseUrl || options.databaseUrl.trim().length === 0) {
      return new LeaderElection({
        pool: null,
        poolKey: null,
        lockNamespace,
        enabled,
        instanceId
      });
    }

    const normalizedUrl = options.databaseUrl.trim();
    const poolKey = `leader-election:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    return new LeaderElection({
      pool: getOrCreatePgPool(poolKey, normalizedUrl),
      poolKey,
      lockNamespace,
      enabled,
      instanceId
    });
  }

  public async close(): Promise<void> {
    if (!this.poolKey) {
      return;
    }
    await releasePgPoolKey(this.poolKey);
  }

  public async runIfLeader<T>(params: RunIfLeaderParams<T>): Promise<T | undefined> {
    if (!this.enabled || !this.pool) {
      return params.onLeader();
    }

    const key = `${this.lockNamespace}:${params.lockKey}`;
    const client = await this.pool.connect();

    try {
      const acquired = await this.tryAcquire(client, key);
      if (!acquired) {
        if (params.onFollower) {
          return await params.onFollower();
        }
        return undefined;
      }

      return await params.onLeader();
    } finally {
      try {
        await this.release(client, key);
      } finally {
        client.release();
      }
    }
  }

  public describeInstance(): string {
    return this.instanceId;
  }

  private async tryAcquire(client: PoolClient, key: string): Promise<boolean> {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired",
      [key]
    );
    return result.rows[0]?.acquired === true;
  }

  private async release(client: PoolClient, key: string): Promise<void> {
    await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [key]);
  }
}
