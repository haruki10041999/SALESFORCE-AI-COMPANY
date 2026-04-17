import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { summarizeBranchDiff } from "../mcp/tools/branch-diff-summary.js";
import { buildBranchDiffPrompt } from "../mcp/tools/branch-diff-to-prompt.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function setupRepo(): { repoPath: string; baseBranch: string; workingBranch: string; cleanup: () => void } {
  const repoPath = mkdtempSync(join(tmpdir(), "sf-ai-company-test-"));

  git(repoPath, ["init"]);
  git(repoPath, ["config", "user.email", "test@example.com"]);
  git(repoPath, ["config", "user.name", "test-user"]);
  git(repoPath, ["checkout", "-b", "main"]);

  const baseBranch = "main";

  writeText(join(repoPath, "README.md"), "# test repo\n");
  writeText(
    join(repoPath, "force-app", "main", "default", "classes", "Base.cls"),
    "public with sharing class Base {\n  public static void run() {}\n}\n"
  );
  git(repoPath, ["add", "."]);
  git(repoPath, ["commit", "-m", "initial commit"]);

  const workingBranch = "feature/diff-review";
  git(repoPath, ["checkout", "-b", workingBranch]);

  writeText(
    join(repoPath, "force-app", "main", "default", "classes", "Base.cls"),
    "public with sharing class Base {\n  public static void run() {}\n  public static void addedMethod() {}\n}\n"
  );
  writeText(
    join(repoPath, "force-app", "main", "default", "lwc", "sampleCmp", "sampleCmp.js"),
    "export default class SampleCmp {}\n"
  );
  writeText(
    join(repoPath, "force-app", "main", "default", "permissionsets", "Admin.permissionset-meta.xml"),
    "<PermissionSet xmlns=\"http://soap.sforce.com/2006/04/metadata\"></PermissionSet>\n"
  );

  git(repoPath, ["add", "."]);
  git(repoPath, ["commit", "-m", "feature changes"]);

  return {
    repoPath,
    baseBranch,
    workingBranch,
    cleanup: () => rmSync(repoPath, { recursive: true, force: true })
  };
}

test("summarizeBranchDiff returns branch comparison and file summary", () => {
  const fixture = setupRepo();
  try {
    const result = summarizeBranchDiff({
      repoPath: fixture.repoPath,
      integrationBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch,
      maxFiles: 10
    });

    assert.equal(result.comparison, `${fixture.baseBranch}...${fixture.workingBranch}`);
    assert.ok(result.filesChanged >= 3);
    assert.ok(result.summary.includes("対応内容（主要差分）"));
    assert.ok(result.fileChanges.some((f) => f.path.endsWith("Base.cls")));
  } finally {
    fixture.cleanup();
  }
});

test("buildBranchDiffPrompt recommends agents from changed file patterns", () => {
  const fixture = setupRepo();
  try {
    const result = buildBranchDiffPrompt({
      repoPath: fixture.repoPath,
      integrationBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch,
      topic: "差分レビュー",
      turns: 6,
      maxHighlights: 10
    });

    assert.ok(result.recommendedAgents.includes("apex-developer"));
    assert.ok(result.recommendedAgents.includes("lwc-developer"));
    assert.ok(result.recommendedAgents.includes("security-engineer"));
    assert.ok(result.prompt.includes("## 主要差分"));
    assert.ok(result.summary.includes("比較:"));
  } finally {
    fixture.cleanup();
  }
});
