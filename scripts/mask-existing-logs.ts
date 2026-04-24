import { existsSync, promises as fsPromises } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { maskUnknown } from "../mcp/core/logging/pii-masker.js";

type CliOptions = {
  outputsDir: string;
  dryRun: boolean;
};

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv: string[]): CliOptions {
  let outputsDir = process.env.SF_AI_OUTPUTS_DIR
    ? resolve(process.env.SF_AI_OUTPUTS_DIR)
    : join(ROOT, "outputs");
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--outputs-dir" && argv[i + 1]) {
      outputsDir = resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
    }
  }

  return { outputsDir, dryRun };
}

async function listSystemEventLogs(outputsDir: string): Promise<string[]> {
  const eventDir = join(outputsDir, "events");
  if (!existsSync(eventDir)) {
    return [];
  }

  const names = await fsPromises.readdir(eventDir);
  return names
    .filter((name) => name === "system-events.jsonl" || (/^system-events\..+\.jsonl$/).test(name))
    .map((name) => join(eventDir, name));
}

async function remaskJsonl(filePath: string, dryRun: boolean): Promise<{ changed: boolean; updatedLines: number }> {
  const raw = await fsPromises.readFile(filePath, "utf-8");
  const lines = raw.split(/\r?\n/);
  let changed = false;
  let updatedLines = 0;

  const remasked = lines.map((line) => {
    if (line.trim().length === 0) {
      return line;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      const masked = maskUnknown(parsed);
      const serialized = JSON.stringify(masked);
      if (serialized !== line) {
        changed = true;
        updatedLines += 1;
      }
      return serialized;
    } catch {
      const maskedLine = String(maskUnknown(line));
      if (maskedLine !== line) {
        changed = true;
        updatedLines += 1;
      }
      return maskedLine;
    }
  });

  if (changed && !dryRun) {
    await fsPromises.writeFile(filePath, remasked.join("\n"), "utf-8");
  }

  return { changed, updatedLines };
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const targets = [
    join(options.outputsDir, "operations-log.jsonl"),
    join(options.outputsDir, "reports", "proposal-feedback.jsonl"),
    ...(await listSystemEventLogs(options.outputsDir))
  ];

  let changedFiles = 0;
  let changedLines = 0;

  for (const target of targets) {
    if (!existsSync(target)) {
      continue;
    }
    const result = await remaskJsonl(target, options.dryRun);
    if (result.changed) {
      changedFiles += 1;
      changedLines += result.updatedLines;
      console.log(`[mask-logs] ${options.dryRun ? "would update" : "updated"}: ${target} (${result.updatedLines} lines)`);
    } else {
      console.log(`[mask-logs] unchanged: ${target}`);
    }
  }

  console.log(`[mask-logs] summary: files=${changedFiles}, lines=${changedLines}, dryRun=${options.dryRun}`);
}

run().catch((error) => {
  console.error(`[mask-logs] failed: ${String(error)}`);
  process.exit(1);
});
