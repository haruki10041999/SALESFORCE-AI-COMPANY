import { promises as fsPromises } from "node:fs";
import { join, resolve } from "node:path";

interface ReplayRecord {
  id: string;
  toolName: string;
  sessionId?: string;
  argsHash: string;
  status: string;
  durationMs?: number;
  recordedAt: string;
  outputJson: Record<string, unknown>;
}

function parseArgs(argv: string[]): { sessionId?: string; outputsDir: string } {
  let sessionId: string | undefined;
  let outputsDir = resolve(process.cwd(), "outputs");
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--session") {
      sessionId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--outputs-dir") {
      outputsDir = resolve(argv[index + 1]);
      index += 1;
    }
  }
  return { sessionId, outputsDir };
}

async function main(): Promise<void> {
  const { sessionId, outputsDir } = parseArgs(process.argv.slice(2));
  if (!sessionId) {
    throw new Error("--session is required");
  }

  const sessionDir = join(outputsDir, "recordings", sessionId);
  const files = (await fsPromises.readdir(sessionDir)).filter((name) => name.endsWith(".json")).sort();
  const records: ReplayRecord[] = [];
  for (const file of files) {
    const raw = await fsPromises.readFile(join(sessionDir, file), "utf-8");
    records.push(JSON.parse(raw) as ReplayRecord);
  }

  const summary = records.map((record) => ({
    toolName: record.toolName,
    status: record.status,
    argsHash: record.argsHash,
    recordedAt: record.recordedAt,
    durationMs: record.durationMs ?? null
  }));
  process.stdout.write(`${JSON.stringify({ sessionId, count: records.length, records: summary }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});