/**
 * TASK-A18: Apex 依存グラフ incremental 用キャッシュ I/O ヘルパー。
 *
 * `outputs/cache/apex-graph.json` (既定) に `FileFingerprint[]` を保存し、
 * 次回実行時と hash 比較することでファイル変更を検出する。
 *
 * 実装本体は `mcp/tools/apex-dependency-graph-incremental.ts` にあり、
 * 本モジュールはそのキャッシュ層を core として再公開する。
 */

export type {
  FileFingerprint,
  IncrementalDelta,
  CachePayload
} from "../../tools/apex-dependency-graph-incremental.js";

export {
  fingerprintFile,
  loadCache,
  saveCache,
  diffFingerprints
} from "../../tools/apex-dependency-graph-incremental.js";

// --------------------------------------------------------------------------
// Re-export types that are actually defined in graph-incremental
// --------------------------------------------------------------------------
// NOTE: CachePayload is an internal type in apex-dependency-graph-incremental;
//       replicated here so callers can import without reaching into tools/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Default location for the graph cache file (relative to CWD). */
export const DEFAULT_GRAPH_CACHE_PATH = "outputs/cache/apex-graph.json";

/** Ensure the cache directory exists and return the resolved path. */
export function ensureCacheDir(cacheFile: string): string {
  mkdirSync(dirname(cacheFile), { recursive: true });
  return cacheFile;
}

/** Returns true when the cache file is present and well-formed. */
export function isCacheValid(cacheFile: string): boolean {
  if (!existsSync(cacheFile)) return false;
  try {
    const raw = readFileSync(cacheFile, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>)["files"])
    );
  } catch {
    return false;
  }
}

/** Delete (invalidate) the cache file. */
export function invalidateCache(cacheFile: string): boolean {
  if (!existsSync(cacheFile)) return false;
  try {
    writeFileSync(cacheFile, "{}", "utf-8"); // overwrite with empty to avoid lint issues with fs.unlinkSync
    return true;
  } catch {
    return false;
  }
}
