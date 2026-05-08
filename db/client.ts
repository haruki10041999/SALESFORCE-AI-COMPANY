import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema/index.js";

export interface DbClient {
  pool: Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
  withTenantSession<T>(tenantId: string | undefined, work: (client: PoolClient) => Promise<T>): Promise<T>;
}

export function createDbClient(databaseUrl = process.env.DATABASE_URL): DbClient {
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error("DATABASE_URL is required to create a DB client");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  async function withTenantSession<T>(tenantId: string | undefined, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, false)", [(tenantId ?? "").trim()]);
      return await work(client);
    } finally {
      try {
        await client.query("RESET app.tenant_id");
      } catch {
        // Ignore cleanup failure and always release.
      }
      client.release();
    }
  }

  return { pool, db, withTenantSession };
}
