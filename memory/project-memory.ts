import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MEMORY_FILE = join(ROOT, "outputs", "memory.jsonl");

const memory: string[] = [];
let storageFilePath = process.env.SF_AI_MEMORY_FILE ?? DEFAULT_MEMORY_FILE;

function loadFromDisk(): void {
  memory.length = 0;
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
  } catch {
    // Ignore read failures and continue in-memory only.
  }
}

function saveToDisk(): void {
  try {
    mkdirSync(dirname(storageFilePath), { recursive: true });
    const payload = memory
      .map((text) => JSON.stringify({ text, savedAt: new Date().toISOString() }))
      .join("\n");
    writeFileSync(storageFilePath, payload.length > 0 ? `${payload}\n` : "", "utf-8");
  } catch {
    // Keep API non-throwing for tool execution stability.
  }
}

loadFromDisk();

export function configureMemoryStorageForTest(filePath: string): void {
  storageFilePath = filePath;
  loadFromDisk();
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
