#!/usr/bin/env -S node --import tsx
/**
 * TASK-F12: lint the top-level layout of `outputs/` against `outputs/.schema.json`.
 *
 * The schema records the allow-list of directories and files that may exist at
 * the top of `outputs/`. Anything else triggers a non-zero exit code so that
 * accidental garbage from ad-hoc scripts or stale tool runs is detected
 * before it ships.
 *
 * Subtree contents are NOT validated; tools own the layout below their own
 * top-level slot.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outputsDir = resolve(repoRoot, "outputs");
const schemaPath = resolve(outputsDir, ".schema.json");

interface Schema {
  allowedDirectories: string[];
  allowedFiles: string[];
}

async function loadSchema(): Promise<Schema> {
  const raw = await readFile(schemaPath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    allowedDirectories: Array.isArray(parsed.allowedDirectories) ? parsed.allowedDirectories : [],
    allowedFiles: Array.isArray(parsed.allowedFiles) ? parsed.allowedFiles : []
  };
}

async function main(): Promise<void> {
  const schema = await loadSchema();
  const dirSet = new Set(schema.allowedDirectories);
  const fileSet = new Set(schema.allowedFiles);
  // The schema file itself is implicitly allowed.
  fileSet.add(".schema.json");

  const entries = await readdir(outputsDir, { withFileTypes: true });
  const violations: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!dirSet.has(entry.name)) {
        violations.push(`unexpected directory: outputs/${entry.name}/`);
      }
    } else if (entry.isFile()) {
      if (!fileSet.has(entry.name)) {
        violations.push(`unexpected file: outputs/${entry.name}`);
      }
    }
  }

  if (violations.length === 0) {
    console.log(`OK: outputs/ matches schema (${entries.length} entries).`);
    return;
  }

  console.error(`FAIL: ${violations.length} unexpected outputs/ entry(ies). Update '${relative(repoRoot, schemaPath)}' if intentional.`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exitCode = 1;
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error("lint-outputs failed:", err);
    process.exit(1);
  });
}

export { main as lintOutputs };
