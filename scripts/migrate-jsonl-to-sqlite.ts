#!/usr/bin/env -S node --import tsx
import { promises as fsPromises } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SQLITE_STATE_FILE,
  SQLiteStateStore,
  type HistorySessionRecord
} from "../mcp/core/persistence/sqlite-store.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..");

interface CliOptions {
  outputsDir: string;
  dbPath: string;
  dryRun: boolean;
}

interface MigrationSummary {
  scannedFiles: number;
  importedJsonlRows: number;
  skippedJsonlRows: number;
  importedHistorySessions: number;
  skippedHistoryFiles: number;
}

function parseArgs(args: string[]): CliOptions {
  let outputsDir = resolve(repoRoot, "outputs");
  let dbPath = resolve(outputsDir, DEFAULT_SQLITE_STATE_FILE);
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--outputs-dir" && i + 1 < args.length) {
      outputsDir = resolve(args[++i]);
    } else if (arg === "--db-path" && i + 1 < args.length) {
      dbPath = resolve(args[++i]);
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  return { outputsDir, dbPath, dryRun };
}

async function collectFiles(dir: string, predicate: (filePath: string) => boolean): Promise<string[]> {
  const entries = await fsPromises.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, predicate)));
      continue;
    }
    if (entry.isFile() && predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function streamNameFromPath(outputsDir: string, filePath: string): string {
  const rel = toPosixPath(relative(outputsDir, filePath));
  return rel.replace(/\.jsonl$/i, "").replace(/\//g, ".");
}

function toHistoryRecord(value: unknown): HistorySessionRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.timestamp !== "string" || typeof v.topic !== "string") {
    return null;
  }
  return {
    id: v.id,
    timestamp: v.timestamp,
    topic: v.topic,
    agents: Array.isArray(v.agents) ? v.agents.filter((x): x is string => typeof x === "string") : [],
    entries: Array.isArray(v.entries) ? v.entries : []
  };
}

async function migrateJsonlFiles(store: SQLiteStateStore, options: CliOptions, summary: MigrationSummary): Promise<void> {
  const jsonlFiles = await collectFiles(options.outputsDir, (filePath) => filePath.endsWith(".jsonl"));
  summary.scannedFiles += jsonlFiles.length;

  for (const filePath of jsonlFiles) {
    const stream = streamNameFromPath(options.outputsDir, filePath);
    const content = await fsPromises.readFile(filePath, "utf-8");
    const lines = content.split(/\r?\n/);

    if (options.dryRun) {
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].trim()) {
          summary.importedJsonlRows += 1;
        }
      }
      continue;
    }

    store.executeInTransaction(() => {
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (!line) continue;
        const inserted = store.insertJsonlRecord({
          stream,
          payload: line,
          sourcePath: toPosixPath(relative(options.outputsDir, filePath)),
          lineNumber: i + 1
        });
        if (inserted) {
          summary.importedJsonlRows += 1;
        } else {
          summary.skippedJsonlRows += 1;
        }
      }
    });
  }
}

async function migrateHistorySessions(store: SQLiteStateStore, options: CliOptions, summary: MigrationSummary): Promise<void> {
  const historyDir = resolve(options.outputsDir, "history");
  let historyFiles: string[] = [];
  try {
    historyFiles = await collectFiles(historyDir, (filePath) => filePath.endsWith(".json"));
  } catch {
    historyFiles = [];
  }

  summary.scannedFiles += historyFiles.length;

  for (const filePath of historyFiles) {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      summary.skippedHistoryFiles += 1;
      continue;
    }

    const record = toHistoryRecord(parsed);
    if (!record) {
      summary.skippedHistoryFiles += 1;
      continue;
    }

    if (options.dryRun) {
      summary.importedHistorySessions += 1;
      continue;
    }

    store.executeInTransaction(() => {
      store.upsertHistorySession(record);
      summary.importedHistorySessions += 1;
    });
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summary: MigrationSummary = {
    scannedFiles: 0,
    importedJsonlRows: 0,
    skippedJsonlRows: 0,
    importedHistorySessions: 0,
    skippedHistoryFiles: 0
  };

  const store = await SQLiteStateStore.open({ dbPath: options.dbPath });
  try {
    await migrateJsonlFiles(store, options, summary);
    await migrateHistorySessions(store, options, summary);

    console.log(
      JSON.stringify(
        {
          mode: options.dryRun ? "dry-run" : "write",
          outputsDir: options.outputsDir,
          dbPath: options.dbPath,
          ...summary
        },
        null,
        2
      )
    );
  } finally {
    store.close();
  }
}

main().catch((error) => {
  console.error("migrate-jsonl-to-sqlite failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
