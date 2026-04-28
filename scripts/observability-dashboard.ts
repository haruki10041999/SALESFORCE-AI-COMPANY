#!/usr/bin/env tsx
import { existsSync, promises as fsPromises } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildObservabilityDashboard,
  type ObservabilityEvent,
  type ObservabilityGovernanceFlagged,
  type ObservabilityTrace
} from "../mcp/core/observability/dashboard.js";

type CliOptions = {
  traceLimit: number;
  eventLimit: number;
  correlationWindowMs: number;
  write: boolean;
  format: "json" | "markdown" | "html";
};

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUTS_DIR = process.env.SF_AI_OUTPUTS_DIR
  ? resolve(process.env.SF_AI_OUTPUTS_DIR)
  : join(ROOT, "outputs");

const TRACE_LOG_FILE = join(OUTPUTS_DIR, "events", "trace-log.jsonl");
const EVENT_DIR = join(OUTPUTS_DIR, "events");
const GOVERNANCE_FILE = join(OUTPUTS_DIR, "resource-governance.json");
const DASHBOARDS_DIR = join(OUTPUTS_DIR, "dashboards");

function printUsage(error?: string): void {
  if (error) {
    console.error(`[observability:dashboard] ${error}`);
    console.error("");
  }
  console.error("Usage:");
  console.error("  npm run observability:dashboard -- [--trace-limit <n>] [--event-limit <n>] [--correlation-window-ms <n>] [--format json|markdown|html] [--no-write]");
  console.error("");
  console.error("Examples:");
  console.error("  npm run observability:dashboard -- --trace-limit 200 --event-limit 1000");
  console.error("  npm run observability:dashboard -- --format markdown --no-write");
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} には正の整数を指定してください: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    traceLimit: 100,
    eventLimit: 1000,
    correlationWindowMs: 5000,
    write: true,
    format: "json"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--trace-limit") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--trace-limit には値が必要です。");
      }
      options.traceLimit = parsePositiveInt(value, "trace-limit");
      i += 1;
      continue;
    }

    if (token === "--event-limit") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--event-limit には値が必要です。");
      }
      options.eventLimit = parsePositiveInt(value, "event-limit");
      i += 1;
      continue;
    }

    if (token === "--correlation-window-ms") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--correlation-window-ms には値が必要です。");
      }
      options.correlationWindowMs = parsePositiveInt(value, "correlation-window-ms");
      i += 1;
      continue;
    }

    if (token === "--format") {
      const value = argv[i + 1];
      if (value !== "json" && value !== "markdown" && value !== "html") {
        throw new Error("--format には json|markdown|html を指定してください。");
      }
      options.format = value;
      i += 1;
      continue;
    }

    if (token === "--no-write") {
      options.write = false;
      continue;
    }

    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`未知のオプションです: ${token}`);
  }

  return options;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asIsoOrNow(value: unknown): string {
  if (typeof value !== "string") {
    return new Date(0).toISOString();
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? value : new Date(0).toISOString();
}

function compareByTimestampAsc<T extends { timestamp: string }>(a: T, b: T): number {
  return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
}

async function readJsonl(filePath: string): Promise<unknown[]> {
  if (!existsSync(filePath)) {
    return [];
  }
  const raw = await fsPromises.readFile(filePath, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((item): item is unknown => item !== null);
}

async function loadTraces(limit: number): Promise<ObservabilityTrace[]> {
  const rows = await readJsonl(TRACE_LOG_FILE);
  const parsed: ObservabilityTrace[] = [];

  for (const row of rows) {
    if (!isObjectRecord(row)) continue;
    const traceId = row.traceId;
    const toolName = row.toolName;
    const startedAt = row.startedAt;
    const status = row.status;
    if (
      typeof traceId !== "string" ||
      typeof toolName !== "string" ||
      typeof startedAt !== "string" ||
      (status !== "running" && status !== "success" && status !== "error")
    ) {
      continue;
    }

    parsed.push({
      traceId,
      toolName,
      startedAt,
      endedAt: typeof row.endedAt === "string" ? row.endedAt : undefined,
      durationMs: typeof row.durationMs === "number" ? row.durationMs : undefined,
      status,
      errorMessage: typeof row.errorMessage === "string" ? row.errorMessage : undefined,
      metadata: isObjectRecord(row.metadata) ? row.metadata : undefined
    });
  }

  return parsed
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
    .slice(-limit);
}

async function loadEvents(limit: number): Promise<ObservabilityEvent[]> {
  if (!existsSync(EVENT_DIR)) {
    return [];
  }

  const files = await fsPromises.readdir(EVENT_DIR);
  const eventFiles = files
    .filter((name) => name === "system-events.jsonl" || /^system-events\..+\.jsonl$/.test(name))
    .map((name) => join(EVENT_DIR, name));

  const withStats = await Promise.all(
    eventFiles.map(async (filePath) => ({
      filePath,
      mtimeMs: (await fsPromises.stat(filePath)).mtimeMs
    }))
  );

  withStats.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const parsed: ObservabilityEvent[] = [];

  for (const { filePath } of withStats) {
    const rows = await readJsonl(filePath);
    for (const row of rows) {
      if (!isObjectRecord(row)) continue;
      const id = row.id;
      const event = row.event;
      const timestamp = row.timestamp;
      if (typeof id !== "string" || typeof event !== "string" || typeof timestamp !== "string") {
        continue;
      }

      parsed.push({
        id,
        event,
        timestamp,
        payload: isObjectRecord(row.payload) ? row.payload : undefined
      });
    }
  }

  return parsed.sort(compareByTimestampAsc).slice(-limit);
}

async function loadGovernanceFlagged(): Promise<ObservabilityGovernanceFlagged[]> {
  if (!existsSync(GOVERNANCE_FILE)) {
    return [];
  }

  const raw = await fsPromises.readFile(GOVERNANCE_FILE, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isObjectRecord(parsed)) {
    return [];
  }

  const flagged: ObservabilityGovernanceFlagged[] = [];
  const disabled = isObjectRecord(parsed.disabled) ? parsed.disabled : {};
  const bugSignals = isObjectRecord(parsed.bugSignals) ? parsed.bugSignals : {};
  const config = isObjectRecord(parsed.config) ? parsed.config : {};
  const thresholds = isObjectRecord(config.thresholds) ? config.thresholds : {};
  const bugSignalToFlag = typeof thresholds.bugSignalToFlag === "number"
    ? thresholds.bugSignalToFlag
    : 5;

  for (const resourceType of ["skills", "tools", "presets"] as const) {
    const disabledNames = Array.isArray(disabled[resourceType]) ? disabled[resourceType] : [];
    for (const name of disabledNames) {
      if (typeof name === "string") {
        flagged.push({ resourceType, name, reason: "disabled" });
      }
    }

    const bugMap = isObjectRecord(bugSignals[resourceType]) ? bugSignals[resourceType] : {};
    for (const [name, count] of Object.entries(bugMap)) {
      if (typeof count === "number" && count >= bugSignalToFlag) {
        flagged.push({ resourceType, name, reason: `bugSignals=${count}` });
      }
    }
  }

  return flagged;
}

async function run(): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    printUsage(String(error));
    return 1;
  }

  try {
    const traces = await loadTraces(options.traceLimit);
    const events = await loadEvents(options.eventLimit);
    const governanceFlagged = await loadGovernanceFlagged();

    const report = buildObservabilityDashboard({
      traces,
      events,
      governanceFlagged,
      correlationWindowMs: options.correlationWindowMs,
      recentLimit: options.traceLimit
    });

    if (options.write) {
      await fsPromises.mkdir(DASHBOARDS_DIR, { recursive: true });
      await fsPromises.writeFile(join(DASHBOARDS_DIR, "observability.html"), report.html, "utf-8");
      await fsPromises.writeFile(join(DASHBOARDS_DIR, "observability.md"), report.markdown, "utf-8");
      await fsPromises.writeFile(
        join(DASHBOARDS_DIR, "observability.json"),
        `${JSON.stringify({
          generatedAt: asIsoOrNow(report.summary.generatedAt),
          summary: report.summary,
          correlations: report.correlations,
          governanceFlagged: report.governanceFlagged
        }, null, 2)}\n`,
        "utf-8"
      );
    }

    console.log(`[observability:dashboard] traces=${traces.length} events=${events.length} flagged=${governanceFlagged.length}`);
    if (options.write) {
      console.log(`[observability:dashboard] written: ${DASHBOARDS_DIR}`);
    }

    if (options.format === "html") {
      console.log(report.html);
    } else if (options.format === "markdown") {
      console.log(report.markdown);
    } else {
      console.log(
        JSON.stringify(
          {
            summary: report.summary,
            correlations: report.correlations,
            governanceFlagged: report.governanceFlagged,
            writtenTo: options.write ? DASHBOARDS_DIR : null
          },
          null,
          2
        )
      );
    }

    return 0;
  } catch (error) {
    console.error(`[observability:dashboard] failed: ${String(error)}`);
    return 1;
  }
}

process.exit(await run());