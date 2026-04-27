#!/usr/bin/env -S node --import tsx
/**
 * TASK-F3 / F9 / F10: tool name extractor.
 *
 * Walks every `mcp/handlers/register-*.ts` and extracts the first string
 * literal argument of every `govTool(...)` / `server.tool(...)` call. This
 * provides a single source of truth for the registered tool catalog without
 * forcing a full code-generation pipeline.
 *
 * Output:
 *   - When invoked directly, prints `<handlerFile>\t<toolName>` per line.
 *   - When invoked with `--json`, prints `{ tools: [{ name, source }, ...] }`.
 *   - When invoked with `--out <path>`, writes the JSON to that file.
 *
 * Programmatic API:
 *   `import { extractRegisteredTools } from "./extract-tool-names.js"`
 *   returns `Promise<RegisteredTool[]>`.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, sep, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const handlersRoot = resolve(repoRoot, "mcp/handlers");

export interface RegisteredTool {
  name: string;
  source: string;
}

const registerCallRegex = /\b(?:govTool|server\.tool)\s*\(\s*["']([a-zA-Z0-9_]+)["']/g;

async function listRegisterFiles(): Promise<string[]> {
  const entries = await readdir(handlersRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.startsWith("register-") && e.name.endsWith(".ts"))
    .map((e) => resolve(handlersRoot, e.name));
}

export async function extractRegisteredTools(): Promise<RegisteredTool[]> {
  const files = await listRegisterFiles();
  const tools: RegisteredTool[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    registerCallRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    const sourceRel = relative(repoRoot, file).split(sep).join("/");
    while ((match = registerCallRegex.exec(source)) !== null) {
      tools.push({ name: match[1], source: sourceRel });
    }
  }
  // Stable order: by name, then by source.
  tools.sort((a, b) => (a.name === b.name ? a.source.localeCompare(b.source) : a.name.localeCompare(b.name)));
  return tools;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantJson = args.includes("--json") || args.includes("--out");
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;

  const tools = await extractRegisteredTools();
  const seen = new Set<string>();
  const unique = tools.filter((t) => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });

  if (wantJson) {
    const payload = JSON.stringify({ generatedAt: new Date().toISOString(), count: unique.length, tools: unique }, null, 2);
    if (outPath) {
      const abs = resolve(repoRoot, outPath);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, payload + "\n", "utf8");
      console.log(`wrote ${unique.length} tools to ${relative(repoRoot, abs)}`);
    } else {
      process.stdout.write(payload + "\n");
    }
    return;
  }

  for (const t of unique) {
    console.log(`${t.source}\t${t.name}`);
  }
  console.error(`# total: ${unique.length} unique tools`);
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error("extract-tool-names failed:", err);
    process.exit(1);
  });
}
