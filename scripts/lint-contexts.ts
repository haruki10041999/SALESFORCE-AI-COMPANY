#!/usr/bin/env node
/**
 * scripts/lint-contexts.ts — TASK-14
 *
 * Validates bounded context import boundaries in mcp/contexts/.
 * Run: npx tsx scripts/lint-contexts.ts
 *
 * Rules enforced:
 *   1. A context must not import internal files of another context
 *      (only the other context's index.ts barrel is allowed).
 *   2. Contexts defined in BOUNDED_CONTEXT_REGISTRY may only depend on
 *      their declared allowedDependencies.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { BOUNDED_CONTEXT_REGISTRY, isCrossContextDependencyAllowed } from "../mcp/contexts/contexts-manifest.js";
import type { BoundedContext } from "../mcp/contexts/contexts-manifest.js";

const ROOT = resolve(process.cwd());
const CONTEXTS_DIR = join(ROOT, "mcp", "contexts");

interface Violation {
  file: string;
  line: number;
  importPath: string;
  reason: string;
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkTs(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function extractImports(src: string): Array<{ path: string; line: number }> {
  const result: Array<{ path: string; line: number }> = [];
  const re = /from\s+["']([^"']+)["']/g;
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let m;
    const singleLineRe = /from\s+["']([^"']+)["']/g;
    while ((m = singleLineRe.exec(lines[i]!)) !== null) {
      result.push({ path: m[1]!, line: i + 1 });
    }
  }
  void re;
  return result;
}

const violations: Violation[] = [];

const contextDirs = readdirSync(CONTEXTS_DIR).filter((d) => {
  return statSync(join(CONTEXTS_DIR, d)).isDirectory();
});

for (const contextDir of contextDirs) {
  const fromContext = contextDir as BoundedContext;
  const files = walkTs(join(CONTEXTS_DIR, contextDir));

  for (const file of files) {
    const src = readFileSync(file, "utf-8");
    const imports = extractImports(src);
    const relFile = relative(ROOT, file).replace(/\\/g, "/");

    for (const imp of imports) {
      // Only check relative imports that could cross context boundaries
      if (!imp.path.startsWith(".") && !imp.path.startsWith("../")) continue;

      // Resolve relative to the importing file's directory
      const importedAbsolute = resolve(join(file, "..", imp.path.replace(/\.js$/, ".ts")));
      const importedRel = relative(ROOT, importedAbsolute).replace(/\\/g, "/");

      if (!importedRel.startsWith("mcp/contexts/")) continue;

      // Determine which context the import targets
      const rest = importedRel.slice("mcp/contexts/".length);
      const toContext = rest.split("/")[0] as BoundedContext;

      if (!toContext || toContext === fromContext) continue;

      // Check if crossing to an undeclared dependency
      if (!isCrossContextDependencyAllowed(fromContext, toContext)) {
        violations.push({
          file: relFile,
          line: imp.line,
          importPath: imp.path,
          reason: `Context "${fromContext}" depends on "${toContext}" which is not listed in its allowedDependencies.`,
        });
        continue;
      }

      // Check if importing internal file instead of index barrel
      const isBarrel = importedRel === `mcp/contexts/${toContext}/index.ts`;
      if (!isBarrel) {
        violations.push({
          file: relFile,
          line: imp.line,
          importPath: imp.path,
          reason: `Cross-context import must use "${toContext}/index.ts" barrel, not internal file "${importedRel}".`,
        });
      }
    }
  }
}

if (violations.length === 0) {
  console.log("✓ No bounded context violations found.");
  process.exit(0);
} else {
  console.error(`✗ ${violations.length} bounded context violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    import "${v.importPath}"`);
    console.error(`    → ${v.reason}\n`);
  }
  process.exit(1);
}
