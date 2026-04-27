#!/usr/bin/env -S node --import tsx
/**
 * TASK-F11: regenerate the governance defaults table inside
 * `docs/configuration.md`.
 *
 * The script imports `DEFAULT_GOVERNANCE_CONFIG` from the single source of
 * truth (`mcp/core/governance/defaults.ts`) and rewrites the section between
 * the markers below. Other sections of the document remain untouched so the
 * file may continue to host hand-authored content.
 *
 * Markers (must already exist in the file):
 *   <!-- AUTO-GOVERNANCE:START -->
 *   <!-- AUTO-GOVERNANCE:END -->
 *
 * If the markers are missing the script appends a new section to the bottom.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_GOVERNANCE_CONFIG } from "../mcp/core/governance/defaults.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const docPath = resolve(repoRoot, "docs/configuration.md");

const START = "<!-- AUTO-GOVERNANCE:START -->";
const END = "<!-- AUTO-GOVERNANCE:END -->";

function renderSection(): string {
  const cfg = DEFAULT_GOVERNANCE_CONFIG;
  const lines: string[] = [];
  lines.push(START);
  lines.push("");
  lines.push("## Governance Defaults (auto-generated)");
  lines.push("");
  lines.push("> Source of truth: `mcp/core/governance/defaults.ts`. Run `npm run docs:config` after editing.");
  lines.push("");
  lines.push("### `maxCounts`");
  lines.push("");
  lines.push("| Resource | Limit |");
  lines.push("| -------- | ----- |");
  for (const [k, v] of Object.entries(cfg.maxCounts)) lines.push(`| ${k} | ${v} |`);
  lines.push("");
  lines.push("### `thresholds`");
  lines.push("");
  lines.push("| Threshold | Value |");
  lines.push("| --------- | ----- |");
  for (const [k, v] of Object.entries(cfg.thresholds)) lines.push(`| ${k} | ${v} |`);
  lines.push("");
  lines.push("### `resourceLimits` (per day)");
  lines.push("");
  lines.push("| Operation | Limit |");
  lines.push("| --------- | ----- |");
  for (const [k, v] of Object.entries(cfg.resourceLimits)) lines.push(`| ${k} | ${v} |`);
  lines.push("");
  lines.push(END);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const section = renderSection();
  let body: string;
  try {
    body = await readFile(docPath, "utf8");
  } catch {
    body = "# Configuration\n\n";
  }

  let next: string;
  if (body.includes(START) && body.includes(END)) {
    const startIdx = body.indexOf(START);
    const endIdx = body.indexOf(END) + END.length;
    next = body.slice(0, startIdx) + section + body.slice(endIdx);
  } else {
    const trimmed = body.endsWith("\n") ? body : body + "\n";
    next = trimmed + "\n" + section + "\n";
  }

  await writeFile(docPath, next, "utf8");
  console.log(`updated governance defaults section in ${relative(repoRoot, docPath)}`);
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error("generate-config-doc failed:", err);
    process.exit(1);
  });
}

export { main as generateConfigDoc };
