/**
 * Metrics auto-update runner.
 * Periodically refreshes learning dashboard and optional drift reports.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "url";
import { parseBooleanLike } from "../config/env-flags.js";
import { getMetricsAutoUpdateEnvConfig } from "../config/runtime-config.js";
import { runLearningPromotionWorkflow } from "../orchestration/workflows/learning-promotion.workflow.js";
import type { EventStore } from "../ports/event-store.js";
import type { NewProposalInput, ProposalRecord } from "../resource/proposal/queue.js";
import { updateLearningProgressDashboard } from "./learning-dashboard-generator.js";
import { runDriftDetectionAndPersist, type DriftReport } from "./drift-detector.js";
import { activateDriftFreeze } from "./drift-freeze.js";
import type { LearningOrchestratorResult, ManualOverrideDecision } from "./learning-orchestrator.js";
import type { ModelRegistrySnapshot } from "./model-registry.js";

export interface MetricsAutoUpdateOptions {
  reportingHours?: number;
  includeDriftDetection?: boolean;
  driftBaselineHours?: number;
  driftRecentHours?: number;
  minRecentRewardSamples?: number;
  rewardDriftThreshold?: number;
  adaptiveRewardDriftThreshold?: boolean;
  minAdaptiveRewardDriftThreshold?: number;
  maxAdaptiveRewardDriftThreshold?: number;
  minReputationSamplesPerWindow?: number;
  regressionThreshold?: number;
  rewardFilePath?: string;
  reputationFilePath?: string;
  driftReportPath?: string;
  freezeOnDriftAlert?: boolean;
  freezeDurationHours?: number;
  freezeStatePath?: string;
  onDriftAlert?: (report: DriftReport) => Promise<void> | void;
  learningOrchestratorEnabled?: boolean;
  learningSnapshotPath?: string;
  learningModelNames?: string[];
  learningCurrentCanaryVersions?: Record<string, string>;
  learningCanaryStatePath?: string;
  learningCanaryTrafficPercent?: number;
  learningManualApprovalRequired?: boolean;
  learningManualOverride?: ManualOverrideDecision;
  learningActorId?: string;
  learningReportPath?: string;
  learningEventStore?: EventStore;
  learningQueueProposal?: (input: NewProposalInput) => Promise<ProposalRecord>;
}

export interface MetricsAutoUpdateResult {
  dashboardUpdated: boolean;
  driftReport?: DriftReport;
  driftAlertEmitted: boolean;
  driftFreezeActivated: boolean;
  learningOrchestratorResults?: LearningOrchestratorResult[];
  updatedAt: string;
}

function parseOptionalCsvList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : undefined;
}

function parseCanaryVersionMap(value: string | undefined): Record<string, string> | undefined {
  if (!value || value.trim().length === 0) return undefined;
  const map: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const [modelNameRaw, versionRaw] = pair.split(":");
    const modelName = modelNameRaw?.trim();
    const version = versionRaw?.trim();
    if (!modelName || !version) continue;
    map[modelName] = version;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

async function runLearningOrchestratorBatch(options: {
  enabled?: boolean;
  snapshotPath?: string;
  modelNames?: string[];
  currentCanaryVersions?: Record<string, string>;
  canaryStatePath?: string;
  canaryTrafficPercent?: number;
  manualApprovalRequired?: boolean;
  manualOverride?: ManualOverrideDecision;
  actorId?: string;
  driftReport?: DriftReport;
  reportPath?: string;
  eventStore?: EventStore;
  queueProposal?: (input: NewProposalInput) => Promise<ProposalRecord>;
}): Promise<LearningOrchestratorResult[] | undefined> {
  if (!options.enabled) return undefined;
  if (!options.snapshotPath || !options.modelNames || options.modelNames.length === 0) return undefined;

  const snapshotPath = resolve(options.snapshotPath);
  const raw = await readFile(snapshotPath, "utf-8");
  let snapshot = JSON.parse(raw) as ModelRegistrySnapshot;
  const results: LearningOrchestratorResult[] = [];
  let canaryVersions: Record<string, string> = { ...(options.currentCanaryVersions ?? {}) };

  if (options.canaryStatePath) {
    const canaryStatePath = resolve(options.canaryStatePath);
    try {
      const canaryRaw = await readFile(canaryStatePath, "utf-8");
      const parsed = JSON.parse(canaryRaw) as Record<string, unknown>;
      const fromFile: Record<string, string> = {};
      for (const [modelName, version] of Object.entries(parsed)) {
        if (typeof version === "string" && version.trim().length > 0) {
          fromFile[modelName] = version;
        }
      }
      // Explicit options override persisted values.
      canaryVersions = { ...fromFile, ...canaryVersions };
    } catch {
      // Missing/invalid state file is treated as no persisted canary map.
    }
  }

  for (const modelName of options.modelNames) {
    const result = await runLearningPromotionWorkflow(
      {
        registrySnapshot: snapshot,
        modelName,
        currentCanaryVersion: canaryVersions[modelName],
        canaryTrafficPercent: options.canaryTrafficPercent,
        manualApprovalRequired: options.manualApprovalRequired,
        manualOverride: options.manualOverride,
        actorId: options.actorId,
        driftReport: options.driftReport
          ? {
              shouldAlert: options.driftReport.shouldAlert,
              ...(options.driftReport.alerts ? { alerts: options.driftReport.alerts } : {})
            }
          : undefined
      },
      {
        eventStore: options.eventStore,
        queueProposal: options.queueProposal
      }
    );
    results.push(result);
    snapshot = result.snapshot;

    if (
      (result.stage === "canary" || result.stage === "proposal_required") &&
      typeof result.candidateVersion === "string" &&
      result.candidateVersion.length > 0
    ) {
      canaryVersions[modelName] = result.candidateVersion;
    } else {
      delete canaryVersions[modelName];
    }
  }

  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");

  if (options.canaryStatePath) {
    const canaryStatePath = resolve(options.canaryStatePath);
    await mkdir(dirname(canaryStatePath), { recursive: true });
    await writeFile(canaryStatePath, JSON.stringify(canaryVersions, null, 2), "utf-8");
  }

  if (options.reportPath) {
    const reportPath = resolve(options.reportPath);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          models: options.modelNames,
          canaryVersions,
          results
        },
        null,
        2
      ),
      "utf-8"
    );
  }

  return results;
}

export async function runMetricsAutoUpdate(
  options: MetricsAutoUpdateOptions = {}
): Promise<MetricsAutoUpdateResult> {
  const reportingHours = options.reportingHours ?? 24;

  await updateLearningProgressDashboard(reportingHours);

  let driftReport: DriftReport | undefined;
  if (options.includeDriftDetection) {
    driftReport = await runDriftDetectionAndPersist({
      baselineHours: options.driftBaselineHours,
      recentHours: options.driftRecentHours,
      minRecentRewardSamples: options.minRecentRewardSamples,
      rewardDriftThreshold: options.rewardDriftThreshold,
      adaptiveRewardDriftThreshold: options.adaptiveRewardDriftThreshold,
      minAdaptiveRewardDriftThreshold: options.minAdaptiveRewardDriftThreshold,
      maxAdaptiveRewardDriftThreshold: options.maxAdaptiveRewardDriftThreshold,
      minReputationSamplesPerWindow: options.minReputationSamplesPerWindow,
      regressionThreshold: options.regressionThreshold,
      rewardFilePath: options.rewardFilePath,
      reputationFilePath: options.reputationFilePath,
      reportPath: options.driftReportPath
    });
  }

  let driftAlertEmitted = false;
  let driftFreezeActivated = false;
  if (driftReport?.shouldAlert && options.onDriftAlert) {
    await options.onDriftAlert(driftReport);
    driftAlertEmitted = true;
  }

  if (driftReport?.shouldAlert && (options.freezeOnDriftAlert ?? true)) {
    await activateDriftFreeze({
      reason: `drift_alert:${driftReport.alerts.join(" | ")}`,
      sourceReportId: driftReport.reportId,
      durationHours: options.freezeDurationHours,
      statePath: options.freezeStatePath
    });
    driftFreezeActivated = true;
  }

  const learningOrchestratorResults = await runLearningOrchestratorBatch({
    enabled: options.learningOrchestratorEnabled,
    snapshotPath: options.learningSnapshotPath,
    modelNames: options.learningModelNames,
    currentCanaryVersions: options.learningCurrentCanaryVersions,
    canaryStatePath: options.learningCanaryStatePath,
    canaryTrafficPercent: options.learningCanaryTrafficPercent,
    manualApprovalRequired: options.learningManualApprovalRequired,
    manualOverride: options.learningManualOverride,
    actorId: options.learningActorId,
    driftReport,
    reportPath: options.learningReportPath,
    eventStore: options.learningEventStore,
    queueProposal: options.learningQueueProposal
  });

  return {
    dashboardUpdated: true,
    driftReport,
    driftAlertEmitted,
    driftFreezeActivated,
    learningOrchestratorResults,
    updatedAt: new Date().toISOString()
  };
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main(): Promise<void> {
  const envConfig = getMetricsAutoUpdateEnvConfig();
  const reportingHours = parseOptionalNumber(envConfig.reportingHours) ?? 24;
  const includeDriftDetection =
    parseBooleanLike(envConfig.includeDriftDetection, false) ||
    process.argv.includes("--with-drift") ||
    process.argv.includes("--drift");
  const freezeOnDriftAlert = parseBooleanLike(envConfig.driftFreezeEnabled, true);
  const learningOrchestratorEnabled = parseBooleanLike(envConfig.learningOrchestratorEnabled, false);

  const result = await runMetricsAutoUpdate({
    reportingHours,
    includeDriftDetection,
    driftBaselineHours: parseOptionalNumber(envConfig.driftBaselineHours),
    driftRecentHours: parseOptionalNumber(envConfig.driftRecentHours),
    minRecentRewardSamples: parseOptionalNumber(envConfig.driftMinRewardSamples),
    rewardDriftThreshold: parseOptionalNumber(envConfig.driftThreshold),
    adaptiveRewardDriftThreshold: envConfig.driftAdaptiveThreshold
      ? parseBooleanLike(envConfig.driftAdaptiveThreshold, false)
      : undefined,
    minAdaptiveRewardDriftThreshold: parseOptionalNumber(envConfig.driftAdaptiveMinThreshold),
    maxAdaptiveRewardDriftThreshold: parseOptionalNumber(envConfig.driftAdaptiveMaxThreshold),
    minReputationSamplesPerWindow: parseOptionalNumber(envConfig.driftMinReputationSamples),
    regressionThreshold: parseOptionalNumber(envConfig.regressionThreshold),
    driftReportPath: envConfig.driftReportPath,
    freezeOnDriftAlert,
    freezeDurationHours: parseOptionalNumber(envConfig.driftFreezeHours),
    freezeStatePath: envConfig.driftFreezeStatePath,
    learningOrchestratorEnabled,
    learningSnapshotPath: envConfig.learningSnapshotPath,
    learningModelNames: parseOptionalCsvList(envConfig.learningModelNames),
    learningCurrentCanaryVersions: parseCanaryVersionMap(envConfig.learningCurrentCanaryMap),
    learningCanaryStatePath: envConfig.learningCanaryStatePath,
    learningCanaryTrafficPercent: parseOptionalNumber(envConfig.learningCanaryTrafficPercent),
    learningManualApprovalRequired: envConfig.learningManualApprovalRequired
      ? parseBooleanLike(envConfig.learningManualApprovalRequired, false)
      : undefined,
    learningManualOverride:
      envConfig.learningManualOverride === "approve" || envConfig.learningManualOverride === "reject"
        ? envConfig.learningManualOverride
        : undefined,
    learningActorId: envConfig.learningActorId,
    learningReportPath: envConfig.learningReportPath
  });

  if (result.driftReport?.shouldAlert) {
    const freezeSuffix = result.driftFreezeActivated ? " (freeze activated)" : "";
    console.log(`[metrics-auto-update] completed with alerts: ${result.driftReport.alerts.join(" | ")}${freezeSuffix}`);
  } else {
    console.log("[metrics-auto-update] completed");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
