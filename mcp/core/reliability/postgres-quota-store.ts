import type { DbClient } from "../../../db/client.js";

export interface TenantQuotaAllowInput {
  tenantId: string;
  toolName: string;
  limit: number;
  nowMs?: number;
  windowMs: number;
}

export interface TenantQuotaAllowResult {
  allowed: boolean;
  count: number;
  remaining: number;
  retryAfterMs: number;
}

type QueryFn = (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

export class PostgresQuotaStore {
  private readonly query: QueryFn;

  public constructor(private readonly options: { dbClient?: DbClient; query?: QueryFn }) {
    if (options.query) {
      this.query = options.query;
      return;
    }
    if (!options.dbClient) {
      throw new Error("PostgresQuotaStore requires dbClient or query function");
    }
    this.query = async (sql: string, params: unknown[]) => {
      const result = await options.dbClient!.pool.query(sql, params);
      return { rows: result.rows as Array<Record<string, unknown>> };
    };
  }

  public async allow(input: TenantQuotaAllowInput): Promise<TenantQuotaAllowResult> {
    const nowMs = input.nowMs ?? Date.now();
    const windowStartMs = nowMs - (nowMs % input.windowMs);
    const windowStartIso = new Date(windowStartMs).toISOString();

    const upsertSql = `
      INSERT INTO tenant_tool_quota_windows (tenant_id, tool_name, window_start, count, updated_at)
      VALUES ($1, $2, $3::timestamptz, 1, NOW())
      ON CONFLICT (tenant_id, tool_name, window_start)
      DO UPDATE SET count = tenant_tool_quota_windows.count + 1, updated_at = NOW()
      RETURNING count
    `;

    const upsert = await this.query(upsertSql, [input.tenantId, input.toolName, windowStartIso]);
    const count = Math.max(0, Number(upsert.rows[0]?.count ?? 0));
    const remaining = Math.max(0, input.limit - count);
    const retryAfterMs = Math.max(1, windowStartMs + input.windowMs - nowMs);

    const cleanupSql = `
      DELETE FROM tenant_tool_quota_windows
      WHERE updated_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
    `;
    void this.query(cleanupSql, [input.windowMs * 3]).catch(() => {
      // Cleanup failure is non-fatal.
    });

    return {
      allowed: count <= input.limit,
      count,
      remaining,
      retryAfterMs
    };
  }
}
