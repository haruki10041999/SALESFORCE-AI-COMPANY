import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type OutputsVersioningCommand = "backup" | "list" | "restore" | "prune";

export interface OutputsVersioningOptions {
  command: OutputsVersioningCommand;
  snapshotName?: string;
  keep: number;
  dryRun: boolean;
  skipPreBackup: boolean;
}

export interface SnapshotRecord {
  id: string;
  path: string;
  createdAt: string;
  entryCount: number;
}

function timestampId(): string {
  return new Date().toISOString().replace(/[.:]/g, "-");
}

function sanitizeSnapshotName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-_]{1,62}$/.test(normalized)) {
    throw new Error(`snapshot 名が不正です: ${name}`);
  }
  return normalized;
}

function ensureDir(pathValue: string): void {
  if (!existsSync(pathValue)) {
    mkdirSync(pathValue, { recursive: true });
  }
}

function listEntriesToBackup(outputsDir: string, backupsDirName: string): string[] {
  if (!existsSync(outputsDir)) {
    return [];
  }
  return readdirSync(outputsDir).filter((name) => name !== backupsDirName);
}

function readSnapshotMetadata(snapshotDir: string): { createdAt: string; entryCount: number } {
  const metaFile = join(snapshotDir, "_meta.json");
  if (!existsSync(metaFile)) {
    return {
      createdAt: new Date(statSync(snapshotDir).mtimeMs).toISOString(),
      entryCount: Math.max(0, readdirSync(snapshotDir).length - 1)
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(metaFile, "utf-8"));
    return {
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date(statSync(snapshotDir).mtimeMs).toISOString(),
      entryCount: typeof parsed.entryCount === "number" ? parsed.entryCount : Math.max(0, readdirSync(snapshotDir).length - 1)
    };
  } catch {
    return {
      createdAt: new Date(statSync(snapshotDir).mtimeMs).toISOString(),
      entryCount: Math.max(0, readdirSync(snapshotDir).length - 1)
    };
  }
}

export function parseOutputsVersioningArgs(argv: string[]): OutputsVersioningOptions {
  const command = argv[0] as OutputsVersioningCommand | undefined;
  if (!command || !["backup", "list", "restore", "prune"].includes(command)) {
    throw new Error("command は backup | list | restore | prune を指定してください。");
  }

  const result: OutputsVersioningOptions = {
    command,
    keep: Number.parseInt(process.env.SF_AI_OUTPUTS_BACKUP_KEEP ?? "5", 10),
    dryRun: false,
    skipPreBackup: false
  };

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--dry-run") {
      result.dryRun = true;
      continue;
    }

    if (token === "--skip-pre-backup") {
      result.skipPreBackup = true;
      continue;
    }

    if (token === "--name") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--name には値が必要です。");
      }
      result.snapshotName = sanitizeSnapshotName(value);
      i += 1;
      continue;
    }

    if (token === "--snapshot") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--snapshot には値が必要です。");
      }
      result.snapshotName = sanitizeSnapshotName(value);
      i += 1;
      continue;
    }

    if (token === "--keep") {
      const value = Number.parseInt(argv[i + 1] ?? "", 10);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error("--keep には 1 以上の整数を指定してください。");
      }
      result.keep = value;
      i += 1;
      continue;
    }

    throw new Error(`未知のオプションです: ${token}`);
  }

  if (result.command === "restore" && !result.snapshotName) {
    throw new Error("restore には --snapshot <name> が必要です。");
  }

  if ((result.command === "backup" || result.command === "restore") && !result.snapshotName) {
    result.snapshotName = `snapshot-${timestampId()}`;
  }

  return result;
}

export function listSnapshots(backupsDir: string): SnapshotRecord[] {
  if (!existsSync(backupsDir)) {
    return [];
  }

  return readdirSync(backupsDir)
    .map((id) => ({ id, path: join(backupsDir, id) }))
    .filter((entry) => {
      try {
        return statSync(entry.path).isDirectory();
      } catch {
        return false;
      }
    })
    .map((entry) => {
      const meta = readSnapshotMetadata(entry.path);
      return {
        id: entry.id,
        path: entry.path,
        createdAt: meta.createdAt,
        entryCount: meta.entryCount
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createSnapshot(outputsDir: string, backupsDir: string, snapshotName: string, dryRun: boolean): SnapshotRecord {
  const snapshotDir = join(backupsDir, snapshotName);
  if (existsSync(snapshotDir)) {
    throw new Error(`同名 snapshot が存在します: ${snapshotName}`);
  }

  const backupsDirName = backupsDir.replace(/\\/g, "/").split("/").pop() ?? "backups";
  const entries = listEntriesToBackup(outputsDir, backupsDirName);

  if (dryRun) {
    return {
      id: snapshotName,
      path: snapshotDir,
      createdAt: new Date().toISOString(),
      entryCount: entries.length
    };
  }

  ensureDir(backupsDir);
  ensureDir(snapshotDir);

  for (const name of entries) {
    cpSync(join(outputsDir, name), join(snapshotDir, name), {
      recursive: true,
      force: true
    });
  }

  const createdAt = new Date().toISOString();
  writeFileSync(
    join(snapshotDir, "_meta.json"),
    JSON.stringify(
      {
        createdAt,
        sourceOutputsDir: outputsDir,
        entryCount: entries.length,
        entries
      },
      null,
      2
    ),
    "utf-8"
  );

  return {
    id: snapshotName,
    path: snapshotDir,
    createdAt,
    entryCount: entries.length
  };
}

export function pruneSnapshots(backupsDir: string, keep: number, dryRun: boolean): { removed: string[]; kept: string[] } {
  const snapshots = listSnapshots(backupsDir);
  if (snapshots.length <= keep) {
    return {
      removed: [],
      kept: snapshots.map((item) => item.id)
    };
  }

  const kept = snapshots.slice(0, keep).map((item) => item.id);
  const removed = snapshots.slice(keep).map((item) => item.id);

  if (!dryRun) {
    for (const id of removed) {
      rmSync(join(backupsDir, id), { recursive: true, force: true });
    }
  }

  return { removed, kept };
}

export function restoreSnapshot(
  outputsDir: string,
  backupsDir: string,
  snapshotName: string,
  dryRun: boolean
): { restoredEntries: string[] } {
  const snapshotDir = join(backupsDir, snapshotName);
  if (!existsSync(snapshotDir) || !statSync(snapshotDir).isDirectory()) {
    throw new Error(`snapshot が見つかりません: ${snapshotName}`);
  }

  const entries = readdirSync(snapshotDir).filter((name) => name !== "_meta.json");

  if (dryRun) {
    return { restoredEntries: entries };
  }

  ensureDir(outputsDir);
  const backupsDirName = backupsDir.replace(/\\/g, "/").split("/").pop() ?? "backups";

  const currentEntries = readdirSync(outputsDir).filter((name) => name !== backupsDirName);
  for (const name of currentEntries) {
    rmSync(join(outputsDir, name), { recursive: true, force: true });
  }

  for (const name of entries) {
    cpSync(join(snapshotDir, name), join(outputsDir, name), {
      recursive: true,
      force: true
    });
  }

  return { restoredEntries: entries };
}
