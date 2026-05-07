import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export interface DbClient {
  pool: Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
}

export function createDbClient(databaseUrl = process.env.DATABASE_URL): DbClient {
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error("DATABASE_URL is required to create a DB client");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
