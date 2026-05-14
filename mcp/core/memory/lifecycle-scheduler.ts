import { Cron } from "croner";
import { Pool } from "pg";
import { getOrCreatePgPool, releasePgPoolKey } from "../persistence/pg-pool-registry.js";

export type VectorTier = "hot" | "warm" | "cold";

export interface VectorLifecyclePolicy {
  hotToWarmDays: number;
  warmToColdDays: number;
}

export interface VectorLifecycleCandidate {
  chunkId: number;
  currentTier: VectorTier;
  createdAt: string;
  updatedAt?: string | null;
}

export interface VectorLifecycleRunResult {
  scanned: number;
  changed: number;
  unchanged: number;
  changes: Array<{ chunkId: number; from: VectorTier; to: VectorTier }>;
}

export interface VectorLifecycleSchedulerOptions {
  databaseUrl: string;
  cronPattern?: string;
  policy?: Partial<VectorLifecyclePolicy>;
  logger?: {
    info(message: string): void;
    warn(message: string): void;
  };
}

const DEFAULT_POLICY: VectorLifecyclePolicy = {
  hotToWarmDays: 7,
  warmToColdDays: 90
};

export function resolveVectorTierForAgeDays(
  ageDays: number,
  policy: VectorLifecyclePolicy = DEFAULT_POLICY
): VectorTier {
  if (ageDays <= policy.hotToWarmDays) {
    return "hot";
  }
  if (ageDays <= policy.warmToColdDays) {
    return "warm";
  }
  return "cold";
}

export function resolveNextTier(
  candidate: VectorLifecycleCandidate,
  now: Date = new Date(),
  policy: VectorLifecyclePolicy = DEFAULT_POLICY
): VectorTier {
  const reference = candidate.updatedAt ?? candidate.createdAt;
  const ts = new Date(reference).getTime();
  if (!Number.isFinite(ts)) {
    return candidate.currentTier;
  }
  const ageMs = Math.max(0, now.getTime() - ts);
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return resolveVectorTierForAgeDays(ageDays, policy);
}

export class VectorLifecycleScheduler {
  private readonly poolKey: string;
  private readonly pool: Pool;
  private readonly policy: VectorLifecyclePolicy;
  private readonly cronPattern: string;
  private readonly logger: { info(message: string): void; warn(message: string): void };
  private job: Cron | null = null;

  constructor(options: VectorLifecycleSchedulerOptions) {
    this.poolKey = `vector-lifecycle:${options.databaseUrl}`;
    this.pool = getOrCreatePgPool(this.poolKey, options.databaseUrl);
    this.policy = {
      hotToWarmDays: options.policy?.hotToWarmDays ?? DEFAULT_POLICY.hotToWarmDays,
      warmToColdDays: options.policy?.warmToColdDays ?? DEFAULT_POLICY.warmToColdDays
    };
    this.cronPattern = options.cronPattern ?? "0 3 * * *";
    this.logger = options.logger ?? console;
  }

  start(): void {
    if (this.job) {
      return;
    }
    this.job = new Cron(this.cronPattern, async () => {
      try {
        const report = await this.runOnce();
        this.logger.info(
          `[vector-lifecycle] scanned=${report.scanned} changed=${report.changed} unchanged=${report.unchanged}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[vector-lifecycle] failed: ${message}`);
      }
    });
  }

  async stop(): Promise<void> {
    this.job?.stop();
    this.job = null;
    await releasePgPoolKey(this.poolKey);
  }

  async runOnce(limit = 2000): Promise<VectorLifecycleRunResult> {
    const result = await this.pool.query<{
      chunk_id: number;
      current_tier: VectorTier;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      [
        "SELECT",
        "  mc.id AS chunk_id,",
        "  mc.vector_tier AS current_tier,",
        "  mc.created_at,",
        "  md.updated_at",
        "FROM memory_chunks mc",
        "JOIN memory_sections ms ON ms.id = mc.section_id",
        "JOIN memory_documents md ON md.id = ms.document_id",
        "ORDER BY mc.id ASC",
        "LIMIT $1"
      ].join("\n"),
      [Math.max(1, limit)]
    );

    const changes: Array<{ chunkId: number; from: VectorTier; to: VectorTier }> = [];

    for (const row of result.rows) {
      const nextTier = resolveNextTier(
        {
          chunkId: Number(row.chunk_id),
          currentTier: row.current_tier,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
          updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at)
        },
        new Date(),
        this.policy
      );
      if (nextTier !== row.current_tier) {
        changes.push({ chunkId: Number(row.chunk_id), from: row.current_tier, to: nextTier });
      }
    }

    if (changes.length > 0) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        for (const change of changes) {
          await client.query("UPDATE memory_chunks SET vector_tier = $2 WHERE id = $1", [
            change.chunkId,
            change.to
          ]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }

    return {
      scanned: result.rowCount ?? 0,
      changed: changes.length,
      unchanged: Math.max(0, (result.rowCount ?? 0) - changes.length),
      changes
    };
  }
}
