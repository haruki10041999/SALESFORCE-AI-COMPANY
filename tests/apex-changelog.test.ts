import { test } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApexChangelog, __testables } from "../mcp/tools/apex-changelog.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function setupRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "apex-changelog-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  // baseline
  mkdirSync(join(root, "force-app", "main", "default", "classes"), { recursive: true });
  mkdirSync(join(root, "force-app", "main", "default", "lwc", "myCmp"), { recursive: true });
  writeFileSync(join(root, "force-app/main/default/classes/Account.cls"), "public class Account {}", "utf-8");
  writeFileSync(join(root, "force-app/main/default/lwc/myCmp/myCmp.js"), "// orig", "utf-8");
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "chore: baseline"]);
  return root;
}

test("A14: categorize maps Salesforce paths into expected buckets", () => {
  assert.equal(__testables.categorize("force-app/main/default/classes/Foo.cls"), "Apex Class");
  assert.equal(__testables.categorize("force-app/main/default/triggers/Bar.trigger"), "Trigger");
  assert.equal(__testables.categorize("force-app/main/default/lwc/cmp/cmp.js"), "LWC");
  assert.equal(__testables.categorize("force-app/main/default/flows/My.flow-meta.xml"), "Flow");
  assert.equal(__testables.categorize("force-app/main/default/permissionsets/PS.permissionset-meta.xml"), "Permission Set");
  assert.equal(__testables.categorize("README.md"), "Other");
});

test("A14: generates changelog with categorised entries from real git diff", () => {
  const repo = setupRepo();
  try {
    // Modify Apex, add Trigger, delete LWC
    writeFileSync(join(repo, "force-app/main/default/classes/Account.cls"), "public class Account { void run(){} }", "utf-8");
    mkdirSync(join(repo, "force-app/main/default/triggers"), { recursive: true });
    writeFileSync(join(repo, "force-app/main/default/triggers/AccTrg.trigger"), "trigger AccTrg on Account (before insert) {}", "utf-8");
    rmSync(join(repo, "force-app/main/default/lwc/myCmp/myCmp.js"));
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "feat(apex): refine Account; add trigger"]);

    const baseSha = git(repo, ["rev-parse", "HEAD~1"]);
    const result = generateApexChangelog({ repoPath: repo, baseRef: baseSha, headRef: "main" });
    assert.equal(result.totalFiles, 3);
    assert.equal(result.byCategory["Apex Class"].length, 1);
    assert.equal(result.byCategory["Trigger"].length, 1);
    assert.equal(result.byCategory["LWC"].length, 1);
    assert.equal(result.byCategory["Apex Class"][0].status, "modified");
    assert.equal(result.byCategory["Trigger"][0].status, "added");
    assert.equal(result.byCategory["LWC"][0].status, "deleted");
    assert.match(result.markdown, /# Apex Changelog/);
    assert.match(result.markdown, /## Apex Class/);
    assert.ok(result.highlights.some((h) => h.startsWith("feat(apex)")));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("A14: empty diff yields totalFiles=0 and a no-changes markdown notice", () => {
  const repo = setupRepo();
  try {
    const result = generateApexChangelog({ repoPath: repo, baseRef: "main", headRef: "main" });
    assert.equal(result.totalFiles, 0);
    assert.match(result.markdown, /No file changes detected/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("A14: rejects unsafe ref names", () => {
  const repo = setupRepo();
  try {
    assert.throws(() => generateApexChangelog({ repoPath: repo, baseRef: "--evil" }), /Invalid baseRef/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
