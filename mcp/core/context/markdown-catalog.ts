import { existsSync, promises as fsPromises, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
import { shouldSkipScanDir } from "../quality/scan-exclusions.js";
import { countTokens } from "../prompt/token-counter.js";
import { AgentFrontmatterSchema, parseFrontmatter } from "../declarative/frontmatter.js";

export function resolveProjectRootFromFile(fileUrl: string): string {
  const thisFile = fileURLToPath(fileUrl);
  // symlink を解決して、シンボリックリンク経由の起動でも安定して走査できるようにする。
  let current: string;
  try {
    current = dirname(realpathSync(thisFile));
  } catch {
    current = dirname(thisFile);
  }
  const seen = new Set<string>();

  // 上限 12 階層 (深度ガード) かつ visited 集合で循環/対称シンボリックリンクを防ぐ。
  for (let i = 0; i < 12; i++) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);

    const hasPackageJson = existsSync(join(current, "package.json"));
    const hasAgentsDir = existsSync(join(current, "agents"));
    if (hasPackageJson && hasAgentsDir) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return resolve(dirname(thisFile), "..", "..");
}

export function findMdFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  
  try {
    // fast-glob で .md ファイルを検索。cwd を指定して、相対的に ** パターンを使用
    const files = fg.sync("**/*.md", {
      cwd: dir,
      absolute: true,  // 絶対パスを返す
      ignore: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/build/**",
        "**/.vscode/**"
      ]
    });
    return files;
  } catch {
    // glob パターンエラーは、カスタムスキャンにフォールバック
    return legacyFindMdFilesRecursive(dir);
  }
}

/**
 * レガシー実装（fast-glob が失敗した場合）
 */
function legacyFindMdFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (shouldSkipScanDir(entry)) continue;
      files.push(...legacyFindMdFilesRecursive(fullPath));
      continue;
    }
    if (entry.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

export function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function assertSafeLookupName(name: string): void {
  const normalized = toPosixPath(name).trim();
  if (!normalized) {
    throw new Error("Invalid name: empty");
  }
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`Invalid name: absolute path is not allowed (${name})`);
  }
  if (normalized.includes("\0")) {
    throw new Error("Invalid name: null byte");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment.length === 0)) {
    throw new Error(`Invalid name: path traversal is not allowed (${name})`);
  }
}

export function truncateContent(text: string, maxTokens: number, label: string): string {
  if (maxTokens <= 0) return "";

  const originalTokenCount = countTokens(text).tokens;
  if (originalTokenCount <= maxTokens) {
    return text;
  }

  const fullSuffix = `\n\n...(${label}: ${originalTokenCount.toLocaleString()} tokens -> ${maxTokens.toLocaleString()} tokens)`;
  const compactSuffix = "\n\n...(truncated)";

  const withFullSuffix = binarySearchPrefixByTokenBudget(text, fullSuffix, maxTokens);
  if (withFullSuffix !== null) {
    return withFullSuffix;
  }

  const withCompactSuffix = binarySearchPrefixByTokenBudget(text, compactSuffix, maxTokens);
  if (withCompactSuffix !== null) {
    return withCompactSuffix;
  }

  // Even suffix-only doesn't fit the budget; return bare prefix constrained by token budget.
  return binarySearchPrefixByTokenBudget(text, "", maxTokens) ?? "";
}

function binarySearchPrefixByTokenBudget(text: string, suffix: string, maxTokens: number): string | null {
  if (countTokens(suffix).tokens > maxTokens) {
    return null;
  }

  let lo = 0;
  let hi = text.length;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = `${text.slice(0, mid)}${suffix}`;
    const tokenCount = countTokens(candidate).tokens;
    if (tokenCount <= maxTokens) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best < 0) {
    return null;
  }

  return `${text.slice(0, best)}${suffix}`;
}

export function listMdFiles(root: string, dir: string): { name: string; summary: string }[] {
  const fullDir = join(root, dir);
  const files = findMdFilesRecursive(fullDir);
  return files
    .map((filePath) => {
      const content = readFileSync(filePath, "utf-8");
      const { data, body } = parseFrontmatter(content);
      const lines = body.split("\n");
      const heading = lines.find((l) => l.startsWith("# ")) ?? "";
      const desc = lines.find((l) => {
        const trimmed = l.trim();
        return trimmed.length > 0 && !trimmed.startsWith("#");
      }) ?? "";
      let summary = heading.replace(/^# /, "") || desc.trim();

      if (dir === "agents") {
        const parsed = AgentFrontmatterSchema.safeParse(data);
        if (parsed.success) {
          const metadata = [
            parsed.data.role,
            parsed.data.capability,
            ...(parsed.data.triggerKeywords ?? []),
            ...(parsed.data.suggestedSkills ?? [])
          ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
          if (metadata.length > 0) {
            summary = summary ? `${summary} ${metadata.join(" ")}` : metadata.join(" ");
          }
        }
      }

      const name = toPosixPath(relative(fullDir, filePath)).replace(/\.md$/, "");
      return { name, summary };
    });
}

export function getMdFile(root: string, dir: string, name: string): string {
  const fullDir = join(root, dir);
  if (!existsSync(fullDir)) throw new Error(`Directory not found: ${dir}`);
  assertSafeLookupName(name);

  const normalizedName = toPosixPath(name).replace(/\.md$/, "");
  const directPath = join(fullDir, `${normalizedName}.md`);
  if (existsSync(directPath)) {
    return readFileSync(directPath, "utf-8");
  }

  const allFiles = findMdFilesRecursive(fullDir);
  const byBaseName = allFiles.filter((p) => basename(p, ".md") === normalizedName);
  if (byBaseName.length === 1) {
    return readFileSync(byBaseName[0], "utf-8");
  }
  if (byBaseName.length > 1) {
    const candidates = byBaseName
      .map((p) => toPosixPath(relative(fullDir, p)).replace(/\.md$/, ""))
      .join(", ");
    throw new Error(`Ambiguous name: ${name}. Use one of: ${candidates}`);
  }

  throw new Error(`Not found: ${name}`);
}

export async function getMdFileAsync(root: string, dir: string, name: string): Promise<string> {
  const fullDir = join(root, dir);
  if (!existsSync(fullDir)) throw new Error(`Directory not found: ${dir}`);
  assertSafeLookupName(name);

  const normalizedName = toPosixPath(name).replace(/\.md$/, "");
  const directPath = join(fullDir, `${normalizedName}.md`);
  if (existsSync(directPath)) {
    return fsPromises.readFile(directPath, "utf-8");
  }

  const allFiles = findMdFilesRecursive(fullDir);
  const byBaseName = allFiles.filter((p) => basename(p, ".md") === normalizedName);
  if (byBaseName.length === 1) {
    return fsPromises.readFile(byBaseName[0], "utf-8");
  }
  if (byBaseName.length > 1) {
    const candidates = byBaseName
      .map((p) => toPosixPath(relative(fullDir, p)).replace(/\.md$/, ""))
      .join(", ");
    throw new Error(`Ambiguous name: ${name}. Use one of: ${candidates}`);
  }

  throw new Error(`Not found: ${name}`);
}
