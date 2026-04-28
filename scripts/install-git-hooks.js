#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const gitDir = join(repoRoot, ".git");
const hooksDir = join(gitDir, "hooks");
const hookPath = join(hooksDir, "pre-commit");
const marker = "# salesforce-ai-company pre-commit hook";
const hookBody = `${marker}\nnode scripts/pre-commit.js\n`;

if (!existsSync(gitDir)) {
  console.log("[hooks] skip: .git directory not found.");
  process.exit(0);
}

mkdirSync(hooksDir, { recursive: true });

if (existsSync(hookPath)) {
  const current = readFileSync(hookPath, "utf-8");
  if (!current.includes(marker)) {
    console.log("[hooks] skip: existing pre-commit hook detected; not overwriting.");
    process.exit(0);
  }
}

writeFileSync(hookPath, `#!/bin/sh\n${hookBody}`, "utf-8");
try {
  chmodSync(hookPath, 0o755);
} catch {
  // Windows may ignore chmod; hook still works.
}
console.log(`[hooks] installed: ${hookPath}`);