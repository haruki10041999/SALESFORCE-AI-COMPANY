#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const scriptPath = path.resolve(__dirname, "ai.ts");
const args = ["--import", "tsx", scriptPath, ...process.argv.slice(2)];

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  shell: false
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.error) {
  console.error(result.error.message);
}
process.exit(1);
