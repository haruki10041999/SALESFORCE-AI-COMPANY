import { existsSync, promises as fsPromises, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveProjectRootFromFile(fileUrl: string): string {
  const thisFile = fileURLToPath(fileUrl);
  let current = dirname(thisFile);

  for (let i = 0; i < 8; i++) {
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
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...findMdFilesRecursive(fullPath));
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

export function truncateContent(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars) +
    `\n\n...(${label}: ${text.length.toLocaleString()}文字 → ${maxChars.toLocaleString()}文字に削減)`
  );
}

export function listMdFiles(root: string, dir: string): { name: string; summary: string }[] {
  const fullDir = join(root, dir);
  const files = findMdFilesRecursive(fullDir);
  return files
    .map((filePath) => {
      const content = readFileSync(filePath, "utf-8");
      const heading = content.split("\n").find((l) => l.startsWith("# ")) ?? "";
      const desc = content.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";
      const name = toPosixPath(relative(fullDir, filePath)).replace(/\.md$/, "");
      return { name, summary: heading.replace(/^# /, "") || desc.trim() };
    });
}

export function getMdFile(root: string, dir: string, name: string): string {
  const fullDir = join(root, dir);
  if (!existsSync(fullDir)) throw new Error(`Directory not found: ${dir}`);

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
