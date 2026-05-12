/**
 * Metrics auto-update runner.
 * Periodically refreshes learning dashboard and optional drift reports.
 */

import { fileURLToPath } from "url";
import { parseBooleanLike } from "../config/env-flags.js";
import { getMetricsAutoUpdateEnvConfig } from "../config/runtime-config.js";
import { updateLearningProgressDashboard } from "./learning-dashboard-generator.js";
import { runDriftDetectionAndPersist, type DriftReport } from "./drift-detector.js";
import { activateDriftFreeze } from "./drift-freeze.js";

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
}

export interface MetricsAutoUpdateResult {
  dashboardUpdated: boolean;
  driftReport?: DriftReport;
  driftAlertEmitted: boolean;
  driftFreezeActivated: boolean;
  updatedAt: string;
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

  return {
    dashboardUpdated: true,
    driftReport,
    driftAlertEmitted,
    driftFreezeActivated,
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
    freezeStatePath: envConfig.driftFreezeStatePath
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
