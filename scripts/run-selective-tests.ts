#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { suggestChangedTests } from "../mcp/tools/changed-tests-suggest.js";

type LocalTestPlan = {
  changedFiles: string[];
  selectedTests: string[];
  reasons: string[];
  fallbackToFull: boolean;
};

type SelectiveTestReport = {
  generatedAt: string;
  comparison: string;
  changedFileCount: number;
  changedFiles: string[];
  localPlan: LocalTestPlan;
  apexSuggestion?: {
    summary: string;
    runCommand?: string;
    suggestionCount: number;
  };
  executed: {
    command: string;
    mode: "selective" | "full" | "dry-run";
  };
};

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const TESTS_DIR = join(ROOT, "tests");

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function runGit(args: string[]): string {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function resolveBaseRef(): string {
  const cli = parseArg("--base");
  if (cli) return cli;
  const envBase = process.env.GITHUB_BASE_REF;
  if (envBase && envBase.trim().length > 0) {
    return `origin/${envBase.trim()}`;
  }
  return "origin/main";
}

function resolveHeadRef(): string {
  return parseArg("--head") ?? "HEAD";
}

function listChangedFiles(baseRef: string, headRef: string): string[] {
  const comparison = `${baseRef}...${headRef}`;
  try {
    const output = runGit(["diff", "--name-only", comparison]);
    return output.split("\n").map((x) => x.trim()).filter(Boolean);
  } catch {
    const fallback = runGit(["diff", "--name-only", "HEAD~1...HEAD"]);
    return fallback.split("\n").map((x) => x.trim()).filter(Boolean);
  }
}

function listTestFiles(): string[] {
  if (!existsSync(TESTS_DIR)) return [];
  return readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => join("tests", name))
    .sort();
}

function buildLocalTestPlan(changedFiles: string[]): LocalTestPlan {
  const selected = new Set<string>();
  const reasons: string[] = [];
  const allTests = listTestFiles();

  for (const file of changedFiles) {
    if (/^tests\/.+\.test\.ts$/i.test(file)) {
      selected.add(file);
      reasons.push(`changed test file: ${file}`);
    }
  }

  const changedTools = changedFiles
    .filter((file) => /^mcp\/tools\/.+\.ts$/i.test(file))
    .map((file) => basename(file, ".ts"));

  for (const toolName of changedTools) {
    for (const testPath of allTests) {
      const abs = join(ROOT, testPath);
      const content = readFileSync(abs, "utf-8");
      if (content.includes(toolName)) {
        selected.add(testPath);
      }
    }
    reasons.push(`tool change mapped by test matrix: ${toolName}`);
  }

  if (changedFiles.some((file) => /^mcp\/handlers\//i.test(file) || /^mcp\/server\.ts$/i.test(file))) {
    selected.add("tests/server-tools.integration.test.ts");
    reasons.push("handler/server change: include integration suite");
  }

  const selectedTests = [...selected].sort();
  const fallbackToFull = selectedTests.length === 0;
  return {
    changedFiles,
    selectedTests,
    reasons,
    fallbackToFull
  };
}

function runLocalTests(testFiles: string[]): string {
  if (testFiles.length === 0) {
    execFileSync("npm", ["test"], {
      cwd: ROOT,
      stdio: "inherit"
    });
    return "npm test";
  }

  const args = ["--test", "--import", "tsx", "--import", "./tests/_setup.ts", ...testFiles];
  execFileSync("node", args, {
    cwd: ROOT,
    stdio: "inherit"
  });
  return `node ${args.join(" ")}`;
}

function writeReport(report: SelectiveTestReport): void {
  const reportsDir = join(ROOT, "outputs", "reports");
  mkdirSync(reportsDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = join(reportsDir, `selective-tests-${stamp}.json`);
  const mdPath = join(reportsDir, `selective-tests-${stamp}.md`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");

  const lines: string[] = [];
  lines.push("# Selective Test Report");
  lines.push("");
  lines.push(`- comparison: ${report.comparison}`);
  lines.push(`- changedFileCount: ${report.changedFileCount}`);
  lines.push(`- localSelectedTests: ${report.localPlan.selectedTests.length}`);
  lines.push(`- mode: ${report.executed.mode}`);
  lines.push(`- command: ${report.executed.command}`);
  if (report.apexSuggestion) {
    lines.push(`- apexSuggestions: ${report.apexSuggestion.suggestionCount}`);
    if (report.apexSuggestion.runCommand) {
      lines.push(`- apexRunCommand: ${report.apexSuggestion.runCommand}`);
    }
  }
  lines.push("");
  if (report.localPlan.selectedTests.length > 0) {
    lines.push("## Selected Tests");
    lines.push("");
    for (const file of report.localPlan.selectedTests) {
      lines.push(`- ${file}`);
    }
  }

  writeFileSync(mdPath, lines.join("\n"), "utf-8");
  console.log(`[selective] report: ${jsonPath}`);
}

function main(): number {
  const baseRef = resolveBaseRef();
  const headRef = resolveHeadRef();
  const dryRun = hasFlag("--dry-run");

  const changedFiles = listChangedFiles(baseRef, headRef);
  const localPlan = buildLocalTestPlan(changedFiles);

  let apexSuggestion: SelectiveTestReport["apexSuggestion"];
  try {
    const apex = suggestChangedTests({
      repoPath: ROOT,
      baseBranch: baseRef,
      workingBranch: headRef
    });
    apexSuggestion = {
      summary: apex.summary,
      runCommand: apex.runCommand,
      suggestionCount: apex.suggestions.length
    };
  } catch {
    // Git refs may not exist in shallow checkout. Ignore apex suggestion in that case.
  }

  let executedCommand = "dry-run";
  let mode: SelectiveTestReport["executed"]["mode"] = "dry-run";

  if (!dryRun) {
    if (localPlan.fallbackToFull) {
      executedCommand = runLocalTests([]);
      mode = "full";
    } else {
      executedCommand = runLocalTests(localPlan.selectedTests);
      mode = "selective";
    }
  }

  const report: SelectiveTestReport = {
    generatedAt: new Date().toISOString(),
    comparison: `${baseRef}...${headRef}`,
    changedFileCount: changedFiles.length,
    changedFiles,
    localPlan,
    apexSuggestion,
    executed: {
      command: executedCommand,
      mode
    }
  };

  writeReport(report);
  console.log(`[selective] changed files: ${report.changedFileCount}`);
  console.log(`[selective] selected tests: ${report.localPlan.selectedTests.length}`);
  if (apexSuggestion?.runCommand) {
    console.log(`[selective] apex suggestion: ${apexSuggestion.runCommand}`);
  }

  return 0;
}

process.exit(main());
