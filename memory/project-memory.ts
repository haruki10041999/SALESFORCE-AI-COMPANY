import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MEMORY_FILE = join(ROOT, "outputs", "memory.jsonl");

const memory: string[] = [];
let storageFilePath = process.env.SF_AI_MEMORY_FILE ?? DEFAULT_MEMORY_FILE;
let maxRecords = Number.parseInt(process.env.SF_AI_MEMORY_MAX_RECORDS ?? "2000", 10);
let maxBytes = Number.parseInt(process.env.SF_AI_MEMORY_MAX_BYTES ?? `${1024 * 1024}`, 10);

function normalizeLimits(): void {
  if (!Number.isFinite(maxRecords) || maxRecords < 10) {
    maxRecords = 2000;
  }
  if (!Number.isFinite(maxBytes) || maxBytes < 1024) {
    maxBytes = 1024 * 1024;
  }
}

function applyRetention(): void {
  if (memory.length > maxRecords) {
    const overflow = memory.length - maxRecords;
    if (overflow > 0) {
      memory.splice(0, overflow);
    }
  }
}

function archivePayloadIfNeeded(payload: string): string {
  const bytes = Buffer.byteLength(payload, "utf-8");
  if (bytes <= maxBytes) {
    return payload;
  }

  try {
    const archivePath = `${storageFilePath}.${Date.now()}.gz`;
    writeFileSync(archivePath, gzipSync(payload));
  } catch (error) {
    // Log archive write failures for operational visibility
    console.warn(`[project-memory] archive failed: ${String(error)}`);
  }

  const keep = Math.max(10, Math.floor(maxRecords / 2));
  if (memory.length > keep) {
    memory.splice(0, memory.length - keep);
  }

  const trimmed = memory
    .map((text) => JSON.stringify({ text, savedAt: new Date().toISOString() }))
    .join("\n");
  return trimmed.length > 0 ? `${trimmed}\n` : "";
}

function loadFromDisk(): void {
  memory.length = 0;
  normalizeLimits();
  if (!existsSync(storageFilePath)) {
    return;
  }

  try {
    const raw = readFileSync(storageFilePath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { text?: unknown };
        if (typeof parsed.text === "string") {
          memory.push(parsed.text);
        }
      } catch {
        // Ignore malformed lines to keep startup resilient.
      }
    }
    applyRetention();
  } catch {
    // Ignore read failures and continue in-memory only.
  }
}

function saveToDisk(): void {
  try {
    normalizeLimits();
    applyRetention();
    mkdirSync(dirname(storageFilePath), { recursive: true });
    const payload = memory
      .map((text) => JSON.stringify({ text, savedAt: new Date().toISOString() }))
      .join("\n");
    const content = archivePayloadIfNeeded(payload.length > 0 ? `${payload}\n` : "");
    writeFileSync(storageFilePath, content, "utf-8");
  } catch {
    // Keep API non-throwing for tool execution stability.
  }
}

loadFromDisk();

export function configureMemoryStorageForTest(filePath: string): void {
  storageFilePath = filePath;
  loadFromDisk();
}

export function configureMemoryLimitsForTest(limits: { maxRecords?: number; maxBytes?: number }): void {
  if (typeof limits.maxRecords === "number") {
    maxRecords = limits.maxRecords;
  }
  if (typeof limits.maxBytes === "number") {
    maxBytes = limits.maxBytes;
  }
  normalizeLimits();
  applyRetention();
  saveToDisk();
}

export function addMemory(data: string): void {
  memory.push(data);
  saveToDisk();
}

export function searchMemory(query: string): string[] {
  const normalized = query.toLowerCase();
  return memory.filter((item) => item.toLowerCase().includes(normalized));
}

export function listMemory(): string[] {
  return [...memory];
}

export function clearMemory(): void {
  memory.length = 0;
  saveToDisk();
}
