/**
 * Metrics auto-update runner.
 * Periodically refreshes learning dashboard and optional drift reports.
 */

import { fileURLToPath } from "url";
import { parseBooleanLike } from "../config/env-flags.js";
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
  const reportingHours = parseOptionalNumber(process.env.SF_AI_METRICS_REPORTING_HOURS) ?? 24;
  const includeDriftDetection =
    parseBooleanLike(process.env.SF_AI_METRICS_WITH_DRIFT, false) ||
    process.argv.includes("--with-drift") ||
    process.argv.includes("--drift");
  const freezeOnDriftAlert = parseBooleanLike(process.env.SF_AI_DRIFT_FREEZE_ENABLED, true);

  const result = await runMetricsAutoUpdate({
    reportingHours,
    includeDriftDetection,
    driftBaselineHours: parseOptionalNumber(process.env.SF_AI_DRIFT_BASELINE_HOURS),
    driftRecentHours: parseOptionalNumber(process.env.SF_AI_DRIFT_RECENT_HOURS),
    minRecentRewardSamples: parseOptionalNumber(process.env.SF_AI_DRIFT_MIN_REWARD_SAMPLES),
    rewardDriftThreshold: parseOptionalNumber(process.env.SF_AI_DRIFT_THRESHOLD),
    adaptiveRewardDriftThreshold: process.env.SF_AI_DRIFT_ADAPTIVE_THRESHOLD
      ? parseBooleanLike(process.env.SF_AI_DRIFT_ADAPTIVE_THRESHOLD, false)
      : undefined,
    minAdaptiveRewardDriftThreshold: parseOptionalNumber(process.env.SF_AI_DRIFT_ADAPTIVE_MIN_THRESHOLD),
    maxAdaptiveRewardDriftThreshold: parseOptionalNumber(process.env.SF_AI_DRIFT_ADAPTIVE_MAX_THRESHOLD),
    minReputationSamplesPerWindow: parseOptionalNumber(
      process.env.SF_AI_DRIFT_MIN_REPUTATION_SAMPLES
    ),
    regressionThreshold: parseOptionalNumber(process.env.SF_AI_REGRESSION_THRESHOLD),
    driftReportPath: process.env.SF_AI_DRIFT_REPORT_PATH,
    freezeOnDriftAlert,
    freezeDurationHours: parseOptionalNumber(process.env.SF_AI_DRIFT_FREEZE_HOURS),
    freezeStatePath: process.env.SF_AI_DRIFT_FREEZE_STATE_PATH
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
