/**
 * Prompt Cache Persistence (TASK-046)
 *
 * chat-prompt-builder の in-memory cache を JSONL に永続化することで、
 * server 再起動後に cache hit を復元できるようにする。複数プロセス間で
 * 共有する場合でも、ファイルロック等の高度な仕組みは持たず、
 * 「append-only + 最終勝者を採用」の簡易設計とする。
 *
 * - フォーマット: 1 行 1 entry の JSONL
 *   `{ "key": "<sha256>", "createdAt": <ms>, "prompt": "...", "input": { ... } }`
 * - TTL 越えのエントリはロード時にスキップ
 * - 破損行はスキップ (warn せず continue)
 *
 * I/O は同期 (writeFileSync / appendFileSync) とする。理由:
 *   - chat-prompt-builder の setCachedPrompt は同期 API
 *   - ホットパスではあるが、JSONL append は数 KB / call で十分高速
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";

export interface PersistedCacheEntry<TInput = unknown> {
  key: string;
  prompt: string;
  createdAt: number;
  input: TInput;
}

function ensureDirSync(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 永続ファイルから cache entry を読み込む。TTL 越えはスキップ。
 * 同一 key が複数回現れた場合は「最後の (= もっとも新しい)」を採用。
 */
export function loadPromptCacheFromDisk<TInput = unknown>(
  filePath: string,
  options: { ttlMs: number; now?: number } = { ttlMs: 60_000 }
): Map<string, PersistedCacheEntry<TInput>> {
  const result = new Map<string, PersistedCacheEntry<TInput>>();
  if (!existsSync(filePath)) return result;

  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs;

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return result;
  }

  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: PersistedCacheEntry<TInput> | null = null;
    try {
      parsed = JSON.parse(trimmed) as PersistedCacheEntry<TInput>;
    } catch {
      continue;
    }
    if (
      !parsed ||
      typeof parsed.key !== "string" ||
      typeof parsed.prompt !== "string" ||
      typeof parsed.createdAt !== "number"
    ) {
      continue;
    }
    if (now - parsed.createdAt > ttlMs) {
      continue;
    }
    result.set(parsed.key, parsed);
  }
  return result;
}

/**
 * 単一エントリを append する。
 */
export function appendPromptCacheEntry<TInput = unknown>(
  filePath: string,
  entry: PersistedCacheEntry<TInput>
): void {
  ensureDirSync(filePath);
  appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * cache ファイルを空にする (clearBuildChatPromptCache から呼び出される)。
 */
export function clearPromptCacheFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  try {
    writeFileSync(filePath, "", "utf-8");
  } catch {
    // ファイル消失等は無視
  }
}

/**
 * 全 entry を一括書き出し（コンパクション）する。
 * append 専用の運用で肥大化したときに呼び出す想定。
 */
export function rewritePromptCacheFile<TInput = unknown>(
  filePath: string,
  entries: Iterable<PersistedCacheEntry<TInput>>
): void {
  ensureDirSync(filePath);
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(JSON.stringify(e));
  }
  writeFileSync(filePath, lines.length > 0 ? lines.join("\n") + "\n" : "", "utf-8");
}
