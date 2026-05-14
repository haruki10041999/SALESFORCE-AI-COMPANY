import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalOutputsAdapter } from "../../infrastructure/outputs/local-outputs-adapter.js";
import { getOutputsDir } from "../config/runtime-config.js";
import { withContextOutputsPort } from "../runtime/with-context.js";

export interface ExecutionOriginRecord {
  timestamp: string;
  toolName: string;
  status: "success" | "error";
  serverRoot: string;
  processCwd: string;
  repoRoots: string[];
  inputPathHints: string[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_OUTPUTS_DIR = resolve(getOutputsDir(resolve(ROOT, "outputs")));

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePathCandidate(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return isAbsolute(trimmed) ? resolve(trimmed) : undefined;
}

function collectInputPathHints(input: unknown): string[] {
  if (!isRecordLike(input)) {
    return [];
  }

  const hints: string[] = [];
  const add = (candidate: unknown) => {
    if (typeof candidate !== "string") {
      return;
    }
    const normalized = normalizePathCandidate(candidate);
    if (normalized) {
      hints.push(normalized);
    }
  };

  add(input.repoPath);
  add(input.rootDir);
  add(input.filePath);

  if (Array.isArray(input.filePaths)) {
    for (const candidate of input.filePaths) {
      add(candidate);
    }
  }

  return [...new Set(hints)];
}

function findNearestGitRoot(startPath: string): string | undefined {
  let current = startPath;

  try {
    const stat = statSync(current);
    if (stat.isFile()) {
      current = dirname(current);
    }
  } catch {
    current = dirname(current);
  }

  while (true) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export function buildExecutionOriginRecord(
  toolName: string,
  input: unknown,
  status: "success" | "error",
  serverRoot: string
): ExecutionOriginRecord {
  const inputPathHints = collectInputPathHints(input);
  const repoRoots = new Set<string>();

  repoRoots.add(serverRoot);

  const cwdGitRoot = findNearestGitRoot(process.cwd());
  if (cwdGitRoot) {
    repoRoots.add(cwdGitRoot);
  }

  for (const hint of inputPathHints) {
    const repoRoot = findNearestGitRoot(hint);
    repoRoots.add(repoRoot ?? (existsSync(hint) && statSync(hint).isDirectory() ? hint : dirname(hint)));
  }

  return {
    timestamp: new Date().toISOString(),
    toolName,
    status,
    serverRoot,
    processCwd: process.cwd(),
    repoRoots: [...repoRoots],
    inputPathHints
  };
}

export async function appendExecutionOrigin(outputsDir: string, record: ExecutionOriginRecord): Promise<void> {
  const relativePath = resolve(outputsDir) === DEFAULT_OUTPUTS_DIR
    ? "execution-origins.jsonl"
    : join("execution-origins.jsonl");
  const outputsPort = withContextOutputsPort(new LocalOutputsAdapter({ outputsDir }));
  await outputsPort.appendEvent(relativePath, record).catch(() => {
    // provenance 記録失敗はツール実行を阻害しない
  });
}