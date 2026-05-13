#!/usr/bin/env tsx
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getOutputsDir } from "../../mcp/core/config/runtime-config.js";
import { writeTextFileAtomic } from "../../mcp/core/persistence/atomic-file.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

export type ComplianceControlStatus = "pass" | "partial" | "fail";

export interface Soc2ControlCheck {
  controlId: string;
  title: string;
  status: ComplianceControlStatus;
  rationale: string;
  evidence: string[];
  iso27001Mappings: string[];
}

export interface ComplianceReport {
  generatedAt: string;
  framework: "SOC2";
  scope: "DR Automation / SIEM Forwarding";
  overallStatus: ComplianceControlStatus;
  controls: Soc2ControlCheck[];
  iso27001Summary: string[];
}

export interface GenerateComplianceReportOptions {
  outputsDir: string;
  reportPath: string;
  markdownPath: string;
}

interface BackupVerifyReportLike {
  ok?: boolean;
  availableSnapshots?: number;
  snapshot?: string;
  issues?: string[];
}

interface DrRestoreReportLike {
  snapshot?: string;
  dryRun?: boolean;
  restoredEntries?: string[];
}

interface SiemExportReportLike {
  provider?: string;
  exportedCount?: number;
  target?: string;
  metrics?: {
    batchesFailed?: number;
    retryCount?: number;
    httpRequestCount?: number;
  };
}

async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function computeOverallStatus(statuses: ComplianceControlStatus[]): ComplianceControlStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("partial")) return "partial";
  return "pass";
}

function toMarkdown(report: ComplianceReport): string {
  const lines: string[] = [];
  lines.push("# SOC2 Compliance Report (DR / SIEM)");
  lines.push("");
  lines.push(`- Generated At: ${report.generatedAt}`);
  lines.push(`- Overall Status: ${report.overallStatus}`);
  lines.push(`- ISO27001 Mappings: ${report.iso27001Summary.join(", ") || "none"}`);
  lines.push("");
  lines.push("| Control | Title | Status | ISO27001 | Rationale |");
  lines.push("|---|---|---|---|---|");
  for (const control of report.controls) {
    lines.push(`| ${control.controlId} | ${control.title} | ${control.status} | ${control.iso27001Mappings.join(", ")} | ${control.rationale} |`);
  }
  lines.push("");
  lines.push("## Evidence");
  lines.push("");
  for (const control of report.controls) {
    lines.push(`### ${control.controlId} ${control.title}`);
    lines.push(`- ISO27001: ${control.iso27001Mappings.join(", ") || "none"}`);
    for (const evidence of control.evidence) {
      lines.push(`- ${evidence}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function parseGenerateComplianceReportArgs(argv: string[]): GenerateComplianceReportOptions {
  const { values } = parseArgs({
    options: {
      "outputs-dir": { type: "string" },
      "report-path": { type: "string" },
      "markdown-path": { type: "string" }
    },
    allowPositionals: false,
    args: argv
  });

  const outputsDir = values["outputs-dir"]?.trim() || resolve(ROOT, getOutputsDir("outputs"));
  return {
    outputsDir,
    reportPath: values["report-path"]?.trim() || join(outputsDir, "reports", "compliance-soc2-latest.json"),
    markdownPath: values["markdown-path"]?.trim() || resolve(ROOT, "docs", "compliance", "soc2-dr-siem-latest.md")
  };
}

export async function generateComplianceReport(options: GenerateComplianceReportOptions): Promise<ComplianceReport> {
  const backupVerifyPath = join(options.outputsDir, "reports", "backup-verify-latest.json");
  const drRestorePath = join(options.outputsDir, "reports", "dr-restore-latest.json");
  const siemExportPath = join(options.outputsDir, "reports", "siem-export-latest.json");

  const backup = await readJsonIfExists<BackupVerifyReportLike>(backupVerifyPath);
  const drRestore = await readJsonIfExists<DrRestoreReportLike>(drRestorePath);
  const siem = await readJsonIfExists<SiemExportReportLike>(siemExportPath);

  const controls: Soc2ControlCheck[] = [];

  const backupOk = backup?.ok === true && (backup.availableSnapshots ?? 0) > 0;
  controls.push({
    controlId: "A1.2",
    title: "Backup Verification",
    status: backupOk ? "pass" : "fail",
    rationale: backupOk
      ? "Backup verification report indicates successful validation with available snapshots."
      : "Backup verification is missing or failed.",
    evidence: [
      `outputs report: ${backupVerifyPath}`,
      `snapshot count: ${String(backup?.availableSnapshots ?? 0)}`,
      `issues: ${(backup?.issues ?? []).join("; ") || "none"}`
    ],
    iso27001Mappings: ["A.12.3.1", "A.17.1.3"]
  });

  const drExists = typeof drRestore?.snapshot === "string" && drRestore.snapshot.length > 0;
  controls.push({
    controlId: "A1.3",
    title: "Disaster Recovery Exercise",
    status: drExists ? "pass" : "fail",
    rationale: drExists
      ? drRestore?.dryRun
        ? "DR restore procedure executed in dry-run mode (exercise evidence available)."
        : "DR restore procedure executed with restore report evidence."
      : "DR restore report is missing.",
    evidence: [
      `outputs report: ${drRestorePath}`,
      `snapshot: ${drRestore?.snapshot ?? "missing"}`,
      `restored entries: ${String((drRestore?.restoredEntries ?? []).length)}`
    ],
    iso27001Mappings: ["A.17.1.2", "A.17.1.3"]
  });

  const exportedCount = siem?.exportedCount ?? 0;
  const failedBatches = siem?.metrics?.batchesFailed ?? 0;
  const siemStatus: ComplianceControlStatus = exportedCount > 0
    ? failedBatches === 0
      ? "pass"
      : "partial"
    : "fail";
  controls.push({
    controlId: "CC7.2",
    title: "Security Monitoring via SIEM",
    status: siemStatus,
    rationale: siemStatus === "pass"
      ? "Audit logs were exported to SIEM successfully."
      : siemStatus === "partial"
        ? "SIEM export occurred but includes failed batches; operator follow-up required."
        : "No SIEM export evidence found.",
    evidence: [
      `outputs report: ${siemExportPath}`,
      `provider: ${siem?.provider ?? "missing"}`,
      `target: ${siem?.target ?? "missing"}`,
      `exported count: ${String(exportedCount)}`,
      `http requests: ${String(siem?.metrics?.httpRequestCount ?? 0)}`,
      `retry count: ${String(siem?.metrics?.retryCount ?? 0)}`
    ],
    iso27001Mappings: ["A.12.4.1", "A.16.1.2"]
  });

  const isoSummary = Array.from(new Set(controls.flatMap((control) => control.iso27001Mappings))).sort();

  const report: ComplianceReport = {
    generatedAt: new Date().toISOString(),
    framework: "SOC2",
    scope: "DR Automation / SIEM Forwarding",
    overallStatus: computeOverallStatus(controls.map((control) => control.status)),
    controls,
    iso27001Summary: isoSummary
  };

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeTextFileAtomic(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await mkdir(dirname(options.markdownPath), { recursive: true });
  await writeTextFileAtomic(options.markdownPath, toMarkdown(report));

  return report;
}

async function main(): Promise<void> {
  const options = parseGenerateComplianceReportArgs(process.argv.slice(2));
  const report = await generateComplianceReport(options);
  console.log(JSON.stringify(report, null, 2));
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
