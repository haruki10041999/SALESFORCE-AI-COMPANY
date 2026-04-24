#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ToolMetadata = {
  name: string;
  inputSchemaKeys?: string[];
  inputSchemaTypes?: Record<string, string>;
};

type ToolManifest = {
  version: string;
  generatedAt: string;
  toolCount: number;
  tools: ToolMetadata[];
};

type BreakingChange = {
  tool: string;
  type: "tool-removed" | "arg-removed" | "arg-type-changed";
  message: string;
};

type CheckResult = {
  generatedAt: string;
  baselineRef: string;
  currentPath: string;
  baselineSource: "git" | "file";
  baselinePath?: string;
  checkedTools: number;
  breakingChanges: BreakingChange[];
};

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

function parseArg(argv: string[], key: string): string | undefined {
  const idx = argv.indexOf(key);
  if (idx < 0) return undefined;
  return argv[idx + 1];
}

function hasFlag(argv: string[], key: string): boolean {
  return argv.includes(key);
}

function loadJson(path: string): ToolManifest {
  return JSON.parse(readFileSync(path, "utf-8")) as ToolManifest;
}

function loadBaselineFromGit(ref: string, path: string): ToolManifest {
  const blobPath = `${ref}:${path.replace(/\\/g, "/")}`;
  const raw = execFileSync("git", ["show", blobPath], {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(raw) as ToolManifest;
}

function mapTools(manifest: ToolManifest): Map<string, ToolMetadata> {
  return new Map(manifest.tools.map((tool) => [tool.name, tool]));
}

function compareManifests(baseline: ToolManifest, current: ToolManifest): BreakingChange[] {
  const changes: BreakingChange[] = [];
  const baseMap = mapTools(baseline);
  const currMap = mapTools(current);

  for (const [toolName, baseTool] of baseMap.entries()) {
    const currTool = currMap.get(toolName);
    if (!currTool) {
      changes.push({
        tool: toolName,
        type: "tool-removed",
        message: `tool removed: ${toolName}`
      });
      continue;
    }

    const baseKeys = new Set(baseTool.inputSchemaKeys ?? []);
    const currKeys = new Set(currTool.inputSchemaKeys ?? []);
    for (const key of baseKeys) {
      if (!currKeys.has(key)) {
        changes.push({
          tool: toolName,
          type: "arg-removed",
          message: `argument removed: ${toolName}.${key}`
        });
      }
    }

    const baseTypes = baseTool.inputSchemaTypes ?? {};
    const currTypes = currTool.inputSchemaTypes ?? {};
    for (const key of Object.keys(baseTypes)) {
      if (!(key in currTypes)) {
        continue;
      }
      if (baseTypes[key] !== currTypes[key]) {
        changes.push({
          tool: toolName,
          type: "arg-type-changed",
          message: `argument type changed: ${toolName}.${key} (${baseTypes[key]} -> ${currTypes[key]})`
        });
      }
    }
  }

  return changes;
}

function renderMarkdown(result: CheckResult): string {
  const lines: string[] = [];
  lines.push("# Tool Compatibility Report");
  lines.push("");
  lines.push(`- generatedAt: ${result.generatedAt}`);
  lines.push(`- baselineRef: ${result.baselineRef}`);
  lines.push(`- baselineSource: ${result.baselineSource}`);
  lines.push(`- checkedTools: ${result.checkedTools}`);
  lines.push(`- breakingCount: ${result.breakingChanges.length}`);
  lines.push("");

  if (result.breakingChanges.length === 0) {
    lines.push("No breaking changes detected.");
    return lines.join("\n");
  }

  lines.push("| tool | type | message |");
  lines.push("|---|---|---|");
  for (const item of result.breakingChanges) {
    lines.push(`| ${item.tool} | ${item.type} | ${item.message} |`);
  }

  return lines.join("\n");
}

function main(): number {
  const argv = process.argv.slice(2);
  const baselineRef = parseArg(argv, "--baseline-ref") ?? "origin/main";
  const baselinePathArg = parseArg(argv, "--baseline-path");
  const currentPath = resolve(parseArg(argv, "--current") ?? join(ROOT, "docs", "internal", "tool-manifest.json"));
  const failOnBreaking = hasFlag(argv, "--fail-on-breaking");

  if (!existsSync(currentPath)) {
    console.error(`[compat] current manifest not found: ${currentPath}`);
    return 1;
  }

  const current = loadJson(currentPath);

  let baseline: ToolManifest;
  let baselineSource: "git" | "file" = "git";
  try {
    if (baselinePathArg) {
      baseline = loadJson(resolve(baselinePathArg));
      baselineSource = "file";
    } else {
      baseline = loadBaselineFromGit(baselineRef, "docs/internal/tool-manifest.json");
      baselineSource = "git";
    }
  } catch (error) {
    console.warn(`[compat] baseline manifest could not be loaded (${String(error)}), compatibility check skipped.`);
    return 0;
  }

  const breakingChanges = compareManifests(baseline, current);
  const result: CheckResult = {
    generatedAt: new Date().toISOString(),
    baselineRef,
    currentPath,
    baselineSource,
    baselinePath: baselinePathArg,
    checkedTools: current.tools.length,
    breakingChanges
  };

  const reportsDir = join(ROOT, "outputs", "reports");
  mkdirSync(reportsDir, { recursive: true });
  const stamp = result.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = join(reportsDir, `tool-compatibility-${stamp}.json`);
  const mdPath = join(reportsDir, `tool-compatibility-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");
  writeFileSync(mdPath, renderMarkdown(result), "utf-8");

  console.log(`[compat] checked tools: ${result.checkedTools}`);
  console.log(`[compat] breaking changes: ${result.breakingChanges.length}`);
  console.log(`[compat] report: ${jsonPath}`);

  if (result.breakingChanges.length > 0) {
    for (const item of result.breakingChanges) {
      console.log(`[compat] ${item.message}`);
    }
  }

  if (failOnBreaking && result.breakingChanges.length > 0) {
    console.error("[compat] breaking changes detected");
    return 1;
  }

  return 0;
}

process.exit(main());
