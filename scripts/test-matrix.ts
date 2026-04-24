import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TOOLS_DIR = join(ROOT, "mcp", "tools");
const TESTS_DIR = join(ROOT, "tests");

function hasArg(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

function listFiles(dir: string, suffix: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .sort();
}

function read(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

function normalizeToolName(toolFile: string): string {
  return basename(toolFile, ".ts");
}

function toMarkdownTable(rows: Array<{ tool: string; tests: string[] }>): string {
  const lines: string[] = [];
  lines.push("| Tool | Test Files | Coverage |");
  lines.push("|---|---|---|");

  for (const row of rows) {
    const coverage = row.tests.length > 0 ? "covered" : "missing";
    const testsCell = row.tests.length > 0 ? row.tests.join(", ") : "-";
    lines.push(`| ${row.tool} | ${testsCell} | ${coverage} |`);
  }

  return lines.join("\n");
}

function main(): void {
  const failOnMissing = hasArg("--fail-on-missing");
  const toolFiles = listFiles(TOOLS_DIR, ".ts");
  const testFiles = listFiles(TESTS_DIR, ".test.ts");

  const rows = toolFiles.map((toolFile) => {
    const toolName = normalizeToolName(toolFile);
    const matchedTests = testFiles.filter((testFile) => {
      const content = read(join(TESTS_DIR, testFile));
      return content.includes(toolName);
    });

    return {
      tool: toolName,
      tests: matchedTests
    };
  });

  const covered = rows.filter((row) => row.tests.length > 0).length;
  const missing = rows.length - covered;

  console.log("# Tool-Test Matrix\n");
  console.log(`- tools: ${rows.length}`);
  console.log(`- covered: ${covered}`);
  console.log(`- missing: ${missing}\n`);
  console.log(toMarkdownTable(rows));

  if (failOnMissing && missing > 0) {
    console.error(`\n[test-matrix] missing coverage detected: ${missing} tool(s)`);
    process.exit(1);
  }
}

main();
