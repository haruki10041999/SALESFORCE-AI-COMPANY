import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";
import { DatabaseSync } from "node:sqlite";
import { resolveServerRuntimePaths } from "../mcp/core/server/server-runtime-paths.js";
import { resolveStateBackend } from "../mcp/core/persistence/state-store.js";

type TargetTable =
  | "orchestration_sessions"
  | "orchestration_steps"
  | "memory_records"
  | "tool_executions"
  | "audit_log";

const ALL_TABLES: TargetTable[] = [
  "orchestration_sessions",
  "orchestration_steps",
  "memory_records",
  "tool_executions",
  "audit_log"
];

loadDotenv({ path: resolve(".env") });
loadDotenv({ path: resolve(".env.local"), override: true });

function parseTableList(raw: string | undefined): TargetTable[] {
  if (!raw || raw.trim().length === 0) {
    return ALL_TABLES;
  }
  const requested = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is TargetTable => (ALL_TABLES as string[]).includes(item));
  return requested.length > 0 ? requested : ALL_TABLES;
}

function buildSqlitePath(): string {
  if (process.env.SF_AI_STATE_DB_PATH) {
    return resolve(process.env.SF_AI_STATE_DB_PATH);
  }
  return resolveServerRuntimePaths(import.meta.url, process.env).stateDbPath;
}

async function migratePostgres(options: {
  databaseUrl: string;
  tenantId: string;
  dryRun: boolean;
  tables: TargetTable[];
}): Promise<void> {
  const pool = new Pool({ connectionString: options.databaseUrl });
  try {
    for (const table of options.tables) {
      const selectSql = `SELECT COUNT(*)::int AS count FROM ${table} WHERE tenant_id IS NULL`;
      const selected = await pool.query<{ count: number }>(selectSql);
      const count = selected.rows[0]?.count ?? 0;
      if (count === 0) {
        process.stdout.write(`[skip] ${table}: no NULL tenant rows\n`);
        continue;
      }

      if (options.dryRun) {
        process.stdout.write(`[dry-run] ${table}: would update ${count} row(s) -> tenant_id='${options.tenantId}'\n`);
        continue;
      }

      const updateSql = `UPDATE ${table} SET tenant_id = $1 WHERE tenant_id IS NULL`;
      const updated = await pool.query(updateSql, [options.tenantId]);
      process.stdout.write(`[ok] ${table}: updated ${updated.rowCount ?? 0} row(s)\n`);
    }
  } finally {
    await pool.end();
  }
}

function sqliteTableExists(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return Boolean(row?.name);
}

function sqliteColumnExists(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

async function migrateSqlite(options: {
  dbPath: string;
  tenantId: string;
  dryRun: boolean;
  tables: TargetTable[];
}): Promise<void> {
  if (!existsSync(options.dbPath)) {
    throw new Error(`SQLite DB file not found: ${options.dbPath}`);
  }

  const db = new DatabaseSync(options.dbPath);
  try {
    for (const table of options.tables) {
      if (!sqliteTableExists(db, table)) {
        process.stdout.write(`[skip] ${table}: table not found\n`);
        continue;
      }
      if (!sqliteColumnExists(db, table, "tenant_id")) {
        process.stdout.write(`[skip] ${table}: tenant_id column not found\n`);
        continue;
      }

      const selected = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id IS NULL`).get() as { count: number };
      const count = Number(selected.count ?? 0);
      if (count === 0) {
        process.stdout.write(`[skip] ${table}: no NULL tenant rows\n`);
        continue;
      }

      if (options.dryRun) {
        process.stdout.write(`[dry-run] ${table}: would update ${count} row(s) -> tenant_id='${options.tenantId}'\n`);
        continue;
      }

      const result = db.prepare(`UPDATE ${table} SET tenant_id = ? WHERE tenant_id IS NULL`).run(options.tenantId) as { changes: number };
      process.stdout.write(`[ok] ${table}: updated ${result.changes} row(s)\n`);
    }
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tenant: { type: "string" },
      tables: { type: "string" },
      backend: { type: "string" },
      "db-path": { type: "string" },
      "database-url": { type: "string" },
      "dry-run": { type: "boolean", default: false }
    },
    strict: false
  });

  const tenantId = (values.tenant ?? process.env.SF_AI_TENANT_ID ?? "").trim();
  if (!tenantId) {
    throw new Error("--tenant is required (or set SF_AI_TENANT_ID)");
  }

  const tables = parseTableList(typeof values.tables === "string" ? values.tables : undefined);
  const backend = resolveStateBackend(
    typeof values.backend === "string" ? values.backend : process.env.SF_AI_STATE_BACKEND
  );
  const dryRun = values["dry-run"] === true;

  process.stdout.write(`tenant migration start: backend=${backend}, tenant=${tenantId}, dryRun=${dryRun}\n`);
  process.stdout.write(`tables: ${tables.join(", ")}\n`);

  if (backend === "postgres") {
    const databaseUrl =
      (typeof values["database-url"] === "string" ? values["database-url"] : process.env.DATABASE_URL) ?? "";
    if (!databaseUrl.trim()) {
      throw new Error("DATABASE_URL is required for postgres backend");
    }
    await migratePostgres({ databaseUrl, tenantId, dryRun, tables });
  } else {
    const dbPath = typeof values["db-path"] === "string" ? resolve(values["db-path"]) : buildSqlitePath();
    await migrateSqlite({ dbPath, tenantId, dryRun, tables });
  }

  process.stdout.write("tenant migration completed\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
