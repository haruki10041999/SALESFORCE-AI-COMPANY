/**
 * TASK-A18: Apex 依存グラフの incremental / 差分モード。
 *
 * 既存 `buildApexDependencyGraph` はリポジトリ全体を毎回リスキャンするが、
 * 大規模 Org では重い。本モジュールは:
 *
 *  1. ソースファイル単位で `mtimeMs` / `size` / 簡易ハッシュをキャッシュ
 *     ファイル (JSON) に保存する。
 *  2. 次回呼び出し時にキャッシュと比較し、変更ファイル一覧（added / modified
 *     / deleted）を算出する。
 *  3. グラフ自体はフルビルドして返すが、差分メタ情報 (`incremental`) を
 *     付与する。これにより呼び出し側は「何が変わったか」を CI コメント等
 *     に活用できる。
 *
 * MEMO: フルビルド自体は既存実装に委譲する。ノード/エッジ単位の局所
 * 再構築まで踏み込むと依存解析の正確性を保てなくなるため、ここでは
 * 「差分の検出」までを incremental 化のスコープとする。
 */
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, type Dirent } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { shouldSkipScanDir } from "../core/quality/scan-exclusions.js";
import {
  buildApexDependencyGraph,
  type ApexDependencyGraphInput,
  type ApexDependencyGraphResult
} from "./apex-dependency-graph.js";

export type ApexDependencyGraphIncrementalInput = ApexDependencyGraphInput & {
  /** Path to the JSON cache file. Created if missing. */
  cacheFile: string;
};

export type FileFingerprint = {
  relativePath: string;
  mtimeMs: number;
  size: number;
  hash: string;
};

export type IncrementalDelta = {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: number;
};

export type ApexDependencyGraphIncrementalResult = ApexDependencyGraphResult & {
  incremental: {
    cacheFile: string;
    cacheHit: boolean;
    delta: IncrementalDelta;
    rebuildScope: "full" | "delta-only";
  };
};

export type CachePayload = {
  generatedAt: string;
  rootDir: string;
  files: FileFingerprint[];
};

const APEX_FILE_REGEX = /\.(cls|trigger)$/i;
const META_REGEX = /\.(flow(?:-meta\.xml)?|permissionset-meta\.xml)$/i;

function listSourceFiles(rootDir: string, includeAux: boolean): string[] {
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    let entries: Dirent[];
    try { entries = readdirSync(cur, { withFileTypes: true }) as unknown as Dirent[]; }
    catch { continue; }
    for (const entry of entries) {
      const next = join(cur, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipScanDir(entry.name)) continue;
        stack.push(next);
        continue;
      }
      if (APEX_FILE_REGEX.test(entry.name) || (includeAux && META_REGEX.test(entry.name))) {
        out.push(next);
      }
    }
  }
  return out;
}

export function fingerprintFile(absolutePath: string, rootDir: string): FileFingerprint {
  const stats = statSync(absolutePath);
  const buffer = readFileSync(absolutePath);
  const hash = createHash("sha1").update(buffer).digest("hex").slice(0, 16);
  return {
    relativePath: relative(rootDir, absolutePath).replace(/\\/g, "/"),
    mtimeMs: Math.floor(stats.mtimeMs),
    size: stats.size,
    hash
  };
}

export function loadCache(cacheFile: string): CachePayload | null {
  if (!existsSync(cacheFile)) return null;
  try {
    const raw = readFileSync(cacheFile, "utf-8");
    const parsed = JSON.parse(raw) as CachePayload;
    if (!Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCache(cacheFile: string, payload: CachePayload): void {
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(payload, null, 2), "utf-8");
}

export function diffFingerprints(
  previous: FileFingerprint[],
  current: FileFingerprint[]
): IncrementalDelta {
  const prevByPath = new Map(previous.map((f) => [f.relativePath, f] as const));
  const curByPath = new Map(current.map((f) => [f.relativePath, f] as const));

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  let unchanged = 0;

  for (const [path, cur] of curByPath) {
    const prev = prevByPath.get(path);
    if (!prev) { added.push(path); continue; }
    if (prev.hash !== cur.hash || prev.size !== cur.size) {
      modified.push(path);
    } else {
      unchanged += 1;
    }
  }
  for (const path of prevByPath.keys()) {
    if (!curByPath.has(path)) deleted.push(path);
  }

  added.sort();
  modified.sort();
  deleted.sort();
  return { added, modified, deleted, unchanged };
}

export function buildApexDependencyGraphIncremental(
  input: ApexDependencyGraphIncrementalInput
): ApexDependencyGraphIncrementalResult {
  const rootDir = resolve(input.rootDir);
  const cacheFile = resolve(input.cacheFile);
  const includeAux = !!(input.includeFlows || input.includePermissionSets);

  const fileAbsList = listSourceFiles(rootDir, includeAux).sort();
  const currentFingerprints = fileAbsList.map((abs) => fingerprintFile(abs, rootDir));

  const previous = loadCache(cacheFile);
  const cacheHit = previous !== null && previous.rootDir === rootDir;
  const delta = cacheHit
    ? diffFingerprints(previous!.files, currentFingerprints)
    : {
        added: currentFingerprints.map((f) => f.relativePath),
        modified: [],
        deleted: [],
        unchanged: 0
      };

  // Full rebuild remains the safest correctness option; the delta is the
  // value-add for downstream consumers (CI comments / dashboards).
  const graph = buildApexDependencyGraph(input);

  saveCache(cacheFile, {
    generatedAt: new Date().toISOString(),
    rootDir,
    files: currentFingerprints
  });

  return {
    ...graph,
    incremental: {
      cacheFile,
      cacheHit,
      delta,
      rebuildScope: "full"
    }
  };
}
