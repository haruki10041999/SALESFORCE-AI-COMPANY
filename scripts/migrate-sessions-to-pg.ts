/**
 * scripts/migrate-sessions-to-pg.ts
 *
 * One-time migration: read all *.json files from outputs/sessions/
 * and persist them into the PostgresSessionStore.
 *
 * Usage:
 *   npx tsx scripts/migrate-sessions-to-pg.ts [--dry-run]
 *
 * Prerequisites:
 *   DATABASE_URL must be set (or in .env)
 *   The target Postgres database must be reachable.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import type { OrchestrationSession } from "../mcp/core/types/index.js";
import { PostgresSessionStore } from "../mcp/core/persistence/session-store.postgres.js";

loadDotenv({ path: resolve(fileURLToPath(import.meta.url), "../../.env") });
loadDotenv({ path: resolve(fileURLToPath(import.meta.url), "../../.env.local"), override: true });

const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const SESSIONS_DIR = process.env.SF_AI_SESSIONS_DIR ?? join(ROOT, "outputs", "sessions");
const rawDatabaseUrl = process.env.DATABASE_URL?.trim();

if (!rawDatabaseUrl) {
  console.error("ERROR: DATABASE_URL is not set. Cannot connect to Postgres.");
  process.exit(1);
}

const DATABASE_URL: string = rawDatabaseUrl;

async function main(): Promise<void> {
  console.log(`Sessions dir : ${SESSIONS_DIR}`);
  console.log(`Dry run      : ${DRY_RUN}`);
  console.log();

  let files: string[];
  try {
    files = (await readdir(SESSIONS_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    console.warn(`Sessions directory not found or empty: ${SESSIONS_DIR}`);
    return;
  }

  if (files.length === 0) {
    console.log("No .json session files found — nothing to migrate.");
    return;
  }

  const store = DRY_RUN
    ? null
    : await PostgresSessionStore.open({ databaseUrl: DATABASE_URL });

  let migrated = 0;
  let skipped = 0;

  for (const file of files) {
    const filePath = join(SESSIONS_DIR, file);
    try {
      const raw = await readFile(filePath, "utf-8");
      const session = JSON.parse(raw) as OrchestrationSession;
      if (!session.id) {
        console.warn(`  SKIP  ${file}: missing id field`);
        skipped += 1;
        continue;
      }
      if (DRY_RUN) {
        console.log(`  [dry] WOULD migrate session ${session.id} (history: ${session.history?.length ?? 0})`);
      } else {
        await store!.upsert(session, -1);
        console.log(`  OK    ${session.id} (history: ${session.history?.length ?? 0})`);
      }
      migrated += 1;
    } catch (err) {
      console.error(`  ERROR ${file}:`, err);
      skipped += 1;
    }
  }

  if (!DRY_RUN && store) {
    await store.close();
  }

  console.log();
  console.log(`Migration complete. Migrated: ${migrated}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
