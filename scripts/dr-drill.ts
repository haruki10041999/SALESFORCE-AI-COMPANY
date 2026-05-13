#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { createSnapshot, pruneSnapshots } from "../mcp/core/governance/outputs-versioning.js";
import { getOutputsDir, getPrimaryDatabaseUrl } from "../mcp/core/config/runtime-config.js";
import { writeTextFileAtomic } from "../mcp/core/persistence/atomic-file.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUTS_DIR = getOutputsDir(join(ROOT, "outputs"));
const BACKUPS_DIR = join(OUTPUTS_DIR, "backups");
const REPORT_PATH = join(OUTPUTS_DIR, "reports", "dr-drill-latest.json");

export interface DrDrillOptions {
  execute: boolean;
  snapshotName: string;
  primaryUrl: string;
  replicaUrl: string;
  promoteCommand?: string;
  dnsCommand?: string;
  rollbackCommand?: string;
  reportPath: string;
  keepSnapshots: number;
}

export interface DrDrillStepResult {
  name: string;
  status: "success" | "skipped" | "failed";
  details?: Record<string, unknown>;
}

export interface DrDrillReport {
  executedAt: string;
  dryRun: boolean;
  outputsDir: string;
  backupsDir: string;
  snapshot: { id: string; path: string; entryCount: number };
  steps: DrDrillStepResult[];
  notes: string[];
}

function parseBooleanFlag(value: string | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function parseDrDrillArgs(argv: string[]): DrDrillOptions {
  const { values } = parseArgs({
    options: {
      execute: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "snapshot-name": { type: "string" },
      "primary-url": { type: "string" },
      "replica-url": { type: "string" },
      "promote-command": { type: "string" },
      "dns-command": { type: "string" },
      "rollback-command": { type: "string" },
      "report-path": { type: "string" },
      "keep-snapshots": { type: "string" }
    },
    allowPositionals: false,
    args: argv
  });

  const snapshotName = values["snapshot-name"]?.trim() || `dr-drill-${new Date().toISOString().replace(/[.:]/g, "-")}`;
  const keepSnapshots = Number.parseInt(values["keep-snapshots"] ?? "5", 10);

  return {
    execute: (values.execute || parseBooleanFlag(process.env.SF_AI_DR_DRILL_EXECUTE)) && !values["dry-run"],
    snapshotName,
    primaryUrl: values["primary-url"]?.trim() || getPrimaryDatabaseUrl() || "",
    replicaUrl: values["replica-url"]?.trim() || process.env.SF_AI_DB_URL_REPLICA?.trim() || "",
    promoteCommand: values["promote-command"]?.trim() || process.env.SF_AI_DR_PROMOTE_COMMAND?.trim() || undefined,
    dnsCommand: values["dns-command"]?.trim() || process.env.SF_AI_DR_DNS_COMMAND?.trim() || undefined,
    rollbackCommand: values["rollback-command"]?.trim() || process.env.SF_AI_DR_ROLLBACK_COMMAND?.trim() || undefined,
    reportPath: values["report-path"]?.trim() || REPORT_PATH,
    keepSnapshots: Number.isFinite(keepSnapshots) && keepSnapshots > 0 ? keepSnapshots : 5
  };
}

async function probeDatabase(url: string, label: string, expectWritable: boolean): Promise<DrDrillStepResult> {
  const pool = new Pool({ connectionString: url });
  try {
    const readiness = await pool.query<{ transaction_read_only: string }>("SHOW transaction_read_only");
    const readOnly = readiness.rows[0]?.transaction_read_only === "on";
    if (expectWritable && readOnly) {
      throw new Error(`${label} database is read-only`);
    }
    if (!expectWritable && !readOnly) {
      throw new Error(`${label} database is writable but replica was expected to be read-only`);
    }

    if (expectWritable) {
      await pool.query("BEGIN");
      await pool.query("CREATE TEMP TABLE IF NOT EXISTS dr_drill_probe(id integer)");
      await pool.query("ROLLBACK");
    }

    await pool.end();
    return {
      name: `${label}-probe`,
      status: "success",
      details: { readOnly }
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    return {
      name: `${label}-probe`,
      status: "failed",
      details: { error: error instanceof Error ? error.message : String(error) }
    };
  }
}

function runHook(command: string | undefined, dryRun: boolean, label: string): DrDrillStepResult {
  if (!command) {
    return { name: label, status: "skipped", details: { reason: "not configured" } };
  }
  if (dryRun) {
    return { name: label, status: "skipped", details: { command } };
  }

  const result = spawnSync(command, { shell: true, stdio: "inherit" });
  if (result.status !== 0) {
    return {
      name: label,
      status: "failed",
      details: { command, exitCode: result.status ?? -1 }
    };
  }

  return { name: label, status: "success", details: { command } };
}

export async function runDrDrill(options: DrDrillOptions): Promise<DrDrillReport> {
  const steps: DrDrillStepResult[] = [];
  const notes: string[] = [];

  if (options.execute && !options.primaryUrl) {
    throw new Error("primary database url is required");
  }
  if (options.execute && !options.replicaUrl) {
    throw new Error("replica database url is required");
  }

  const snapshot = createSnapshot(OUTPUTS_DIR, BACKUPS_DIR, options.snapshotName, !options.execute);
  steps.push({ name: "pre-drill-snapshot", status: options.execute ? "success" : "skipped", details: { snapshotId: snapshot.id, entryCount: snapshot.entryCount } });

  if (options.execute) {
    const primaryProbe = await probeDatabase(options.primaryUrl, "primary", true);
    steps.push(primaryProbe);
    const replicaProbe = await probeDatabase(options.replicaUrl, "replica", false);
    steps.push(replicaProbe);

    const promote = runHook(options.promoteCommand, false, "replica-promote");
    steps.push(promote);
    if (promote.status === "failed") {
      notes.push("promotion hook failed; rollback may be required");
    }

    const dns = runHook(options.dnsCommand, false, "dns-switch");
    steps.push(dns);
    if (dns.status === "failed") {
      notes.push("dns switch hook failed; rollback may be required");
    }

    if ((promote.status === "failed" || dns.status === "failed") && options.rollbackCommand) {
      const rollback = runHook(options.rollbackCommand, false, "rollback");
      steps.push(rollback);
      if (rollback.status === "success") {
        notes.push("rollback hook executed after cutover failure");
      }
    }

    const postCutover = await probeDatabase(options.primaryUrl, "primary-post-cutover", true);
    steps.push(postCutover);

    if (postCutover.status === "success") {
      notes.push("primary writable after cutover");
    }
  } else {
    steps.push({ name: "primary-probe", status: "skipped", details: { reason: "dry-run" } });
    steps.push({ name: "replica-probe", status: "skipped", details: { reason: "dry-run" } });
    steps.push({ name: "replica-promote", status: "skipped", details: { command: options.promoteCommand ?? null } });
    steps.push({ name: "dns-switch", status: "skipped", details: { command: options.dnsCommand ?? null } });
    steps.push({ name: "primary-post-cutover", status: "skipped", details: { reason: "dry-run" } });
    notes.push("dry-run executed only; use --execute to run hooks and probes");
  }

  const pruned = pruneSnapshots(BACKUPS_DIR, options.keepSnapshots, !options.execute);
  steps.push({ name: "snapshot-prune", status: "success", details: pruned });

  const report: DrDrillReport = {
    executedAt: new Date().toISOString(),
    dryRun: !options.execute,
    outputsDir: OUTPUTS_DIR,
    backupsDir: BACKUPS_DIR,
    snapshot,
    steps,
    notes
  };

  await writeTextFileAtomic(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main(): Promise<void> {
  const options = parseDrDrillArgs(process.argv.slice(2));
  const report = await runDrDrill(options);
  console.log(JSON.stringify(report, null, 2));
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
