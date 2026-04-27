#!/usr/bin/env node
// Test runner wrapper.
// - Boots tsx ESM loader and the shared test setup file via --import.
// - Forwards extra CLI arguments to `node --test` (e.g. file globs, --watch).
// - Default target is `tests/**/*.test.ts` when no extra arguments are provided.
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const setupFile = pathToFileURL(resolve(repoRoot, "tests/_setup.ts")).href;

const userArgs = process.argv.slice(2);
const targets = userArgs.length > 0 ? userArgs : ["tests/**/*.test.ts"];

const args = [
  "--test",
  "--import",
  "tsx",
  "--import",
  setupFile,
  ...targets,
];

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  cwd: repoRoot,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
