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
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv from "ajv";
import { parseToolSpec } from "../mcp/core/declarative/tool-spec.js";
import {
  createProgressBar,
  createSpinner,
  formatError,
  formatSuccess,
  formatWarn,
  renderJsonPatch
} from "./support/cli-output.js";
import { t } from "./support/i18n.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outputsDir = resolve(repoRoot, "outputs");
const schemaPath = resolve(outputsDir, ".schema.json");

interface Schema {
  allowedDirectories: string[];
  allowedFiles: string[];
}

const schemaValidator = (() => {
  const ajv = new Ajv();
  return ajv.compile({
    type: "object",
    properties: {
      allowedDirectories: { type: "array", items: { type: "string" } },
      allowedFiles: { type: "array", items: { type: "string" } }
    },
    required: ["allowedDirectories", "allowedFiles"],
    additionalProperties: true
  });
})();

/**
 * Allow timestamped gzip archives for known top-level jsonl files.
 * Example: memory.jsonl.1777359892395.gz
 */
function isAllowedOutputFile(name: string, allowedFiles: Set<string>): boolean {
  if (allowedFiles.has(name)) return true;
  const archived = name.match(/^(.+\.jsonl)\.(\d{10,})\.gz$/);
  if (!archived) return false;
  const baseName = archived[1];
  return allowedFiles.has(baseName);
}

async function loadSchema(): Promise<Schema | null> {
  try {
    const raw = await readFile(schemaPath, "utf8");
    const parsed = JSON.parse(raw);
    // Validate against JSON Schema using ajv
    if (!schemaValidator(parsed)) {
      throw new Error(
        t("lintOutputs.fail.invalidSchema", {
          details:
            schemaValidator.errors
              ?.map((e) => `${("instancePath" in e ? e.instancePath : "") || "/"} ${e.message ?? "invalid"}`)
              .join(", ") || "unknown error"
        })
      );
    }
    return parsed as Schema;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(formatWarn(t("lintOutputs.warn.schemaMissing")));
      return null;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const fix = process.argv.includes("--fix");
  const spinner = createSpinner(t("lintOutputs.spinner.scan"));
  const schema = await loadSchema();
  if (!schema) {
    const declViolations = await lintDeclarativeTools();
    spinner?.stop();
    if (declViolations.length > 0) {
      console.error(formatError(t("lintOutputs.fail.invalidDeclarativeTools", { count: declViolations.length })));
      for (const v of declViolations) console.error(`  - ${v}`);
      process.exitCode = 1;
      return;
    }
    console.log(formatSuccess(t("lintOutputs.ok.skipped")));
    return;
  }
  const dirSet = new Set(schema.allowedDirectories);
  const fileSet = new Set(schema.allowedFiles);
  // The schema file itself is implicitly allowed.
  fileSet.add(".schema.json");

  const entries = await readdir(outputsDir, { withFileTypes: true });
  const violations: string[] = [];
  const newDirs: string[] = [];
  const newFiles: string[] = [];
  const seenDirNames = new Set<string>();
  const seenFileNames = new Set<string>();
  const progress = createProgressBar(entries.length);
  let processed = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      seenDirNames.add(entry.name);
      if (!dirSet.has(entry.name)) {
        if (fix) newDirs.push(entry.name);
        else violations.push(`unexpected directory: outputs/${entry.name}/`);
      }
    } else if (entry.isFile()) {
      seenFileNames.add(entry.name);
      if (!isAllowedOutputFile(entry.name, fileSet)) {
        if (fix) newFiles.push(entry.name);
        else violations.push(`unexpected file: outputs/${entry.name}`);
      }
    }
    processed += 1;
    progress?.update(processed);
  }
  progress?.stop();

  // Stale エントリ (schema 側に残っているが実体が消えたもの) を警告。
  const staleDirs = schema.allowedDirectories.filter((d) => !seenDirNames.has(d));
  const staleFiles = schema.allowedFiles.filter((f) => !seenFileNames.has(f));
  for (const d of staleDirs) console.warn(formatWarn(t("lintOutputs.warn.staleDirectory", { name: d })));
  for (const f of staleFiles) console.warn(formatWarn(t("lintOutputs.warn.staleFile", { name: f })));

  if (fix && (newDirs.length > 0 || newFiles.length > 0)) {
    const before = await readFile(schemaPath, "utf8");
    const updated = {
      ...(JSON.parse(before) as Record<string, unknown>),
      allowedDirectories: [...new Set([...schema.allowedDirectories, ...newDirs])].sort(),
      allowedFiles: [...new Set([...schema.allowedFiles, ...newFiles])].sort()
    };
    const after = JSON.stringify(updated, null, 2) + "\n";
    await writeFile(schemaPath, after, "utf8");
    console.log(formatSuccess(t("lintOutputs.ok.fixed", { dirs: newDirs.length, files: newFiles.length })));
    console.log(renderJsonPatch(before, after, relative(repoRoot, schemaPath)));
  }

  if (violations.length === 0) {
    const declViolations = await lintDeclarativeTools();
    spinner?.stop();
    if (declViolations.length > 0) {
      console.error(formatError(t("lintOutputs.fail.invalidDeclarativeTools", { count: declViolations.length })));
      for (const v of declViolations) console.error(`  - ${v}`);
      process.exitCode = 1;
      return;
    }
    console.log(formatSuccess(t("lintOutputs.ok.schemaMatches", { count: entries.length })));
    return;
  }

  spinner?.stop();
  console.error(
    formatError(
      t("lintOutputs.fail.unexpectedEntries", {
        count: violations.length,
        schemaPath: relative(repoRoot, schemaPath)
      })
    )
  );
  for (const v of violations) console.error(`  - ${v}`);
  process.exitCode = 1;
}

async function lintDeclarativeTools(): Promise<string[]> {
  const dir = resolve(outputsDir, "custom-tools");
  const violations: string[] = [];
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return violations; // ディレクトリ未作成は OK
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(dir, file);
    try {
      const raw = await readFile(filePath, "utf-8");
      const json = JSON.parse(raw);
      const spec = parseToolSpec(json);
      if (!spec) {
        violations.push(`outputs/custom-tools/${file}: not a valid DeclarativeToolSpec or legacy CustomToolDefinition`);
      }
    } catch (e) {
      violations.push(`outputs/custom-tools/${file}: ${(e as Error).message}`);
    }
  }
  return violations;
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(formatError(`${t("lintOutputs.fail.fatal")}: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  });
}

export { main as lintOutputs };
