import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema/index.js";

export interface DbClient {
  pool: Pool;
  readPool: Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
  readDb: ReturnType<typeof drizzle<typeof schema>>;
  withTenantSession<T>(tenantId: string | undefined, work: (client: PoolClient) => Promise<T>): Promise<T>;
  withReadTenantSession<T>(tenantId: string | undefined, work: (client: PoolClient) => Promise<T>): Promise<T>;
}

function resolveDatabaseUrls(databaseUrl: string | undefined): { primary: string; replica: string } {
  const primary =
    process.env.SF_AI_DB_URL_PRIMARY?.trim()
    || databaseUrl?.trim()
    || process.env.DATABASE_URL?.trim()
    || "";
  const replica = process.env.SF_AI_DB_URL_REPLICA?.trim() || primary;
  return { primary, replica };
}

async function withTenantSetting<T>(
  pool: Pool,
  tenantId: string | undefined,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
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

export function createDbClient(databaseUrl = process.env.DATABASE_URL): DbClient {
  const { primary, replica } = resolveDatabaseUrls(databaseUrl);
  if (!primary) {
    throw new Error("DATABASE_URL is required to create a DB client");
  }

  const pool = new Pool({ connectionString: primary });
  const readPool = replica === primary ? pool : new Pool({ connectionString: replica });

  const db = drizzle(pool, { schema });
  const readDb = drizzle(readPool, { schema });

  async function withTenantSession<T>(tenantId: string | undefined, work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withTenantSetting(pool, tenantId, work);
  }

  async function withReadTenantSession<T>(
    tenantId: string | undefined,
    work: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    return withTenantSetting(readPool, tenantId, work);
  }

  return { pool, readPool, db, readDb, withTenantSession, withReadTenantSession };
}
