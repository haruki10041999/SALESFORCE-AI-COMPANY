#!/usr/bin/env -S node --import tsx
/**
 * TASK-F5: lint mcp/core/* import edges against `core/layer-manifest.ts`.
 *
 * Walks every .ts file under `mcp/core/`, extracts relative imports, classifies
 * the source and target by directory segment, and reports edges that violate
 * the declared dependency direction (data <- logic <- observable).
 *
 * Exit code:
 *   - 0: no violations
 *   - 1: violations found OR unexpected IO error
 *
 * Usage: `npm run lint:core-layers` or `tsx scripts/lint-core-layers.ts`.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isAllowedLayerEdge,
  resolveLayerForCorePath,
  type CoreLayer
} from "../mcp/core/layer-manifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const coreRoot = resolve(repoRoot, "mcp/core");

interface Violation {
  fromFile: string;
  fromLayer: CoreLayer;
  toFile: string;
  toLayer: CoreLayer;
  importSpecifier: string;
}

async function walkTsFiles(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walkTsFiles(full, acc);
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        acc.push(full);
      }
    })
  );
  return acc;
}

const importRegex = /^\s*import\s+(?:[^"';]+?\s+from\s+)?["']([^"']+)["']/gm;

function* extractRelativeImports(source: string): Generator<string> {
  let match: RegExpExecArray | null;
  importRegex.lastIndex = 0;
  while ((match = importRegex.exec(source)) !== null) {
    const spec = match[1];
    if (spec.startsWith(".")) yield spec;
  }
}

async function resolveImportTarget(fromFile: string, specifier: string): Promise<string | null> {
  const baseDir = dirname(fromFile);
  const cleaned = specifier.replace(/\.js$/, "");
  const candidates = [
    `${cleaned}.ts`,
    `${cleaned}.tsx`,
    `${cleaned}/index.ts`,
    cleaned
  ];
  for (const candidate of candidates) {
    const abs = resolve(baseDir, candidate);
    try {
      const info = await stat(abs);
      if (info.isFile()) return abs;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function relativeToCore(absFile: string): string | null {
  const rel = relative(coreRoot, absFile);
  if (rel.startsWith("..")) return null;
  return rel.split(sep).join("/");
}

async function main(): Promise<void> {
  const files = await walkTsFiles(coreRoot);
  const violations: Violation[] = [];

  for (const file of files) {
    const fromRel = relativeToCore(file);
    if (!fromRel) continue;
    const fromLayer = resolveLayerForCorePath(fromRel);
    if (!fromLayer) continue;

    const source = await readFile(file, "utf8");
    for (const spec of extractRelativeImports(source)) {
      const target = await resolveImportTarget(file, spec);
      if (!target) continue;
      const toRel = relativeToCore(target);
      if (!toRel) continue; // import outside core, ignore for layer rules
      const toLayer = resolveLayerForCorePath(toRel);
      if (!toLayer) continue;
      if (!isAllowedLayerEdge(fromLayer, toLayer)) {
        violations.push({
          fromFile: fromRel,
          fromLayer,
          toFile: toRel,
          toLayer,
          importSpecifier: spec
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log(`OK: scanned ${files.length} files under mcp/core, no layer violations.`);
    return;
  }

  console.error(`FAIL: ${violations.length} layer violation(s) detected.`);
  for (const v of violations) {
    console.error(
      `  [${v.fromLayer}] ${v.fromFile} -> [${v.toLayer}] ${v.toFile}  (import "${v.importSpecifier}")`
    );
  }
  process.exitCode = 1;
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error("lint-core-layers failed:", err);
    process.exit(1);
  });
}

export { main as lintCoreLayers };
