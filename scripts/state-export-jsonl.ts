#!/usr/bin/env -S node --import tsx
import { promises as fsPromises } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SQLITE_STATE_FILE, SQLiteStateStore } from "../mcp/core/persistence/sqlite-store.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..");

interface CliOptions {
  dbPath: string;
  outDir: string;
  stream?: string;
  includeHistory: boolean;
  verifySourceDir?: string;
  allowMismatch: boolean;
}

function parseArgs(args: string[]): CliOptions {
  let dbPath = resolve(repoRoot, "outputs", DEFAULT_SQLITE_STATE_FILE);
  let outDir = resolve(repoRoot, "outputs", "exported-jsonl");
  let stream: string | undefined;
  let includeHistory = true;
  let verifySourceDir: string | undefined;
  let allowMismatch = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--db-path" && i + 1 < args.length) {
      dbPath = resolve(args[++i]);
    } else if (arg === "--out-dir" && i + 1 < args.length) {
      outDir = resolve(args[++i]);
    } else if (arg === "--stream" && i + 1 < args.length) {
      stream = args[++i];
    } else if (arg === "--no-history") {
      includeHistory = false;
    } else if (arg === "--verify-source-dir" && i + 1 < args.length) {
      verifySourceDir = resolve(args[++i]);
    } else if (arg === "--allow-mismatch") {
      allowMismatch = true;
    }
  }

  return { dbPath, outDir, stream, includeHistory, verifySourceDir, allowMismatch };
}

function streamToFilePath(outDir: string, stream: string): string {
  const rel = stream.replace(/\./g, "/") + ".jsonl";
  return join(outDir, rel);
}

async function writeJsonl(filePath: string, lines: string[]): Promise<void> {
  await fsPromises.mkdir(dirname(filePath), { recursive: true });
  const body = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  await fsPromises.writeFile(filePath, body, "utf-8");
}

async function collectJsonlFiles(dir: string): Promise<string[]> {
  const entries = await fsPromises.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonlFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }
  return files;
}

function isSameOrChildPath(basePath: string, candidatePath: string): boolean {
  const normalizedBase = resolve(basePath).toLowerCase();
  const normalizedCandidate = resolve(candidatePath).toLowerCase();
  return normalizedCandidate === normalizedBase || normalizedCandidate.startsWith(normalizedBase + "\\") || normalizedCandidate.startsWith(normalizedBase + "/");
}

async function countJsonlRows(sourceDir: string, excludedDir?: string): Promise<number> {
  const files = await collectJsonlFiles(sourceDir);
  let count = 0;
  for (const filePath of files) {
    if (excludedDir && isSameOrChildPath(excludedDir, filePath)) {
      continue;
    }
    const content = await fsPromises.readFile(filePath, "utf-8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) {
        count += 1;
      }
    }
  }
  return count;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const store = await SQLiteStateStore.open({ dbPath: options.dbPath });

  try {
    const targetStreams = options.stream ? [options.stream] : store.listJsonlStreams();
    let exportedFiles = 0;
    let exportedRows = 0;

    for (const stream of targetStreams) {
      const rows = store.listJsonlRecords(stream);
      const lines = rows.map((row) => row.payload);
      const filePath = streamToFilePath(options.outDir, stream);
      await writeJsonl(filePath, lines);
      exportedFiles += 1;
      exportedRows += rows.length;
    }

    let exportedHistoryRows = 0;
    if (options.includeHistory) {
      const sessions = store.listHistorySessions();
      const lines = sessions.map((session) => JSON.stringify(session));
      await writeJsonl(join(options.outDir, "history", "sessions.jsonl"), lines);
      exportedHistoryRows = sessions.length;
    }

    let verification:
      | {
          sourceDir: string;
          sourceJsonlRows: number;
          exportedRows: number;
          matched: boolean;
        }
      | undefined;

    if (options.verifySourceDir) {
      const sourceJsonlRows = await countJsonlRows(options.verifySourceDir, options.outDir);
      verification = {
        sourceDir: options.verifySourceDir,
        sourceJsonlRows,
        exportedRows,
        matched: sourceJsonlRows === exportedRows
      };
    }

    const result = {
      dbPath: options.dbPath,
      outDir: options.outDir,
      exportedFiles,
      exportedRows,
      exportedHistoryRows,
      streamFilter: options.stream ?? null,
      verification: verification ?? null
    };

    console.log(JSON.stringify(result, null, 2));

    if (verification && !verification.matched && !options.allowMismatch) {
      process.exitCode = 1;
    }
  } finally {
    store.close();
  }
}

main().catch((error) => {
  console.error("state-export-jsonl failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
