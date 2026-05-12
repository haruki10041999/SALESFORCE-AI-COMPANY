import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteFileSync } from "../mcp/core/io/atomic-write.js";
import {
  getAnalyticsStore,
  hasAnalyticsDatabaseConfig
} from "../mcp/core/persistence/analytics-store-provider.js";
import {
  createAtRestCryptoFromEnv,
  parseEncryptedEnvelope,
  type EncryptedEnvelope
} from "../mcp/core/security/at-rest-crypto.js";

export interface FailureMemoryEntry {
  pattern: string;
  reason: string;
  preventiveAction: string;
  tags: string[];
  recordedAt: string;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FAILURE_MEMORY_FILE = join(ROOT, "outputs", "failure-memory.jsonl");

let storageFilePath = process.env.SF_AI_FAILURE_MEMORY_FILE ?? DEFAULT_FAILURE_MEMORY_FILE;
const entries: FailureMemoryEntry[] = [];

function shouldUseDatabase(): boolean {
  return hasAnalyticsDatabaseConfig() && resolve(storageFilePath) === resolve(DEFAULT_FAILURE_MEMORY_FILE);
}

function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.alg === "string"
    && typeof record.keyId === "string"
    && typeof record.iv === "string"
    && typeof record.tag === "string"
    && typeof record.ciphertext === "string";
}

function tryDecryptPayload(raw: string): string {
  const atRestCrypto = createAtRestCryptoFromEnv();
  if (!atRestCrypto) {
    return raw;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return raw;
  }
  try {
    const parsed = parseEncryptedEnvelope(trimmed);
    if (!isEncryptedEnvelope(parsed)) {
      return raw;
    }
    return atRestCrypto.decryptUtf8(parsed);
  } catch {
    return raw;
  }
}

function loadFromDisk(): void {
  entries.length = 0;
  if (!existsSync(storageFilePath)) {
    return;
  }

  try {
    const raw = readFileSync(storageFilePath, "utf-8");
    const resolved = tryDecryptPayload(raw);
    const lines = resolved.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Partial<FailureMemoryEntry>;
        if (
          typeof parsed.pattern === "string" &&
          typeof parsed.reason === "string" &&
          typeof parsed.preventiveAction === "string"
        ) {
          entries.push({
            pattern: parsed.pattern,
            reason: parsed.reason,
            preventiveAction: parsed.preventiveAction,
            tags: Array.isArray(parsed.tags)
              ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
              : [],
            recordedAt: typeof parsed.recordedAt === "string" ? parsed.recordedAt : new Date().toISOString()
          });
        }
      } catch {
        // skip malformed lines to keep startup resilient
      }
    }
  } catch {
    // ignore read failure and continue with in-memory only mode
  }
}

function saveAll(): void {
  try {
    mkdirSync(dirname(storageFilePath), { recursive: true });
    const content = entries.map((entry) => JSON.stringify(entry)).join("\n");
    const payload = content.length > 0 ? `${content}\n` : "";
    const atRestCrypto = createAtRestCryptoFromEnv();
    if (!atRestCrypto) {
      atomicWriteFileSync(storageFilePath, payload, "utf-8");
      return;
    }
    const encrypted = atRestCrypto.encryptUtf8(payload);
    atomicWriteFileSync(storageFilePath, `${JSON.stringify(encrypted)}\n`, "utf-8");
  } catch {
    // keep API non-throwing for tool stability
  }
}

async function loadFromDatabase(): Promise<void> {
  const analyticsStore = await getAnalyticsStore();
  if (!analyticsStore || !shouldUseDatabase()) {
    return;
  }

  try {
    const rows = await analyticsStore.listFailureMemory();
    entries.length = 0;
    entries.push(...rows);
  } catch {
    // ignore database read failure and continue with in-memory mode
  }
}

async function persistToDatabase(): Promise<void> {
  const analyticsStore = await getAnalyticsStore();
  if (!analyticsStore || !shouldUseDatabase()) {
    return;
  }

  try {
    await analyticsStore.replaceFailureMemory(entries);
  } catch {
    // keep API non-throwing for tool stability
  }
}

loadFromDisk();
void loadFromDatabase();

export function configureFailureMemoryStorageForTest(filePath: string): void {
  storageFilePath = filePath;
  loadFromDisk();
}

export function recordFailureMemory(input: {
  pattern: string;
  reason: string;
  preventiveAction: string;
  tags?: string[];
}): Promise<FailureMemoryEntry> {
  const entry: FailureMemoryEntry = {
    pattern: input.pattern,
    reason: input.reason,
    preventiveAction: input.preventiveAction,
    tags: input.tags?.filter((tag) => tag.trim().length > 0) ?? [],
    recordedAt: new Date().toISOString()
  };

  entries.push(entry);
  if (shouldUseDatabase()) {
    return persistToDatabase().then(() => entry);
  }
  saveAll();
  return Promise.resolve(entry);
}

export async function searchFailureMemory(query: string, limit = 10): Promise<FailureMemoryEntry[]> {
  if (shouldUseDatabase()) {
    await loadFromDatabase();
  }
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return [];
  }

  return entries
    .filter((entry) => {
      const haystack = [entry.pattern, entry.reason, entry.preventiveAction, ...entry.tags]
        .join("\n")
        .toLowerCase();
      return haystack.includes(normalized);
    })
    .slice(-Math.max(1, limit))
    .reverse();
}

export async function listFailureMemory(limit = 50): Promise<FailureMemoryEntry[]> {
  if (shouldUseDatabase()) {
    await loadFromDatabase();
  }
  return entries.slice(-Math.max(1, limit)).reverse();
}
