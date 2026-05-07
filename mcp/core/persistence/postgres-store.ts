import { Pool, type PoolClient } from "pg";
import type { GovernanceStateRowRecord, StateStore } from "./state-store.js";

export interface PostgresStateStoreOptions {
  databaseUrl: string;
}

export class PostgresStateStore implements StateStore {
  private readonly pool: Pool;
  private schemaReady = false;

  private constructor(pool: Pool) {
    this.pool = pool;
  }

  public static async open(options: PostgresStateStoreOptions): Promise<PostgresStateStore> {
    if (!options.databaseUrl || options.databaseUrl.trim().length === 0) {
      throw new Error("DATABASE_URL is required for PostgresStateStore");
    }

    const pool = new Pool({ connectionString: options.databaseUrl });
    const store = new PostgresStateStore(pool);
    await store.ensureSchema();
    return store;
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public async getGovernanceStateRow(): Promise<GovernanceStateRowRecord | null> {
    await this.ensureSchema();
    const result = await this.pool.query<{ state_json: unknown; updated_at: Date | string }>(
      "SELECT state_json, updated_at FROM governance_state WHERE id = 1"
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at);
    const stateJson = typeof row.state_json === "string"
      ? row.state_json
      : JSON.stringify(row.state_json ?? {});
    return {
      stateJson,
      updatedAt
    };
  }

  public async upsertGovernanceStateRow(stateJson: string, updatedAt: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      [
        "INSERT INTO governance_state(id, state_json, updated_at)",
        "VALUES (1, $1, $2::timestamptz)",
        "ON CONFLICT(id) DO UPDATE SET",
        "  state_json = EXCLUDED.state_json,",
        "  updated_at = EXCLUDED.updated_at"
      ].join("\n"),
      [stateJson, updatedAt]
    );
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await this.ensureSchemaWithClient(client);
      this.schemaReady = true;
    } finally {
      client.release();
    }
  }

  private async ensureSchemaWithClient(client: PoolClient): Promise<void> {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query(
      [
        "CREATE TABLE IF NOT EXISTS governance_state(",
        "  id smallint PRIMARY KEY CHECK (id = 1),",
        "  state_json jsonb NOT NULL,",
        "  updated_at timestamptz NOT NULL",
        ")"
      ].join("\n")
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_governance_state_updated_at ON governance_state(updated_at DESC)"
    );
  }
}
