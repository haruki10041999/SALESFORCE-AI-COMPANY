#!/usr/bin/env -S node --import tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = resolve(ROOT, "outputs", "reports", "release-notes.md");

function parseArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

function renderMarkdown(input: {
  generatedAt: string;
  baseRef: string;
  headRef: string;
  commits: Array<{ hash: string; subject: string; author: string }>;
  changedFiles: string[];
}): string {
  const lines: string[] = [];
  lines.push("# Release Notes");
  lines.push("");
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push(`Range: ${input.baseRef}..${input.headRef}`);
  lines.push("");

  lines.push("## Commit Summary");
  lines.push("");
  if (input.commits.length === 0) {
    lines.push("- No commits in range");
  } else {
    for (const commit of input.commits) {
      lines.push(`- ${commit.subject} (${commit.hash}) - ${commit.author}`);
    }
  }
  lines.push("");

  lines.push("## Changed Files");
  lines.push("");
  if (input.changedFiles.length === 0) {
    lines.push("- No file changes detected");
  } else {
    for (const file of input.changedFiles) {
      lines.push(`- ${file}`);
    }
  }

  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const baseRef = parseArg("--base") ?? "origin/main";
  const headRef = parseArg("--head") ?? "HEAD";

  const git = simpleGit(ROOT);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error("git repository is required to generate release notes");
  }

  const log = await git.log({ from: baseRef, to: headRef });
  const diff = await git.diff(["--name-only", `${baseRef}..${headRef}`]);

  const commits = log.all.map((item) => ({
    hash: item.hash.slice(0, 8),
    subject: item.message,
    author: item.author_name
  }));
  const changedFiles = diff
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();

  const markdown = renderMarkdown({
    generatedAt: new Date().toISOString(),
    baseRef,
    headRef,
    commits,
    changedFiles
  });

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, markdown, "utf-8");

  console.log(`release notes written: ${join("outputs", "reports", "release-notes.md")}`);
}

main().catch((error) => {
  console.error(`release-notes failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
