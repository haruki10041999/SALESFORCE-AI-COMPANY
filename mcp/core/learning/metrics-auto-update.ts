/**
 * Metrics auto-update runner.
 * Periodically refreshes learning dashboard and optional drift reports.
 */

import { fileURLToPath } from "url";
import { updateLearningProgressDashboard } from "./learning-dashboard-generator.js";
import { runDriftDetectionAndPersist, type DriftReport } from "./drift-detector.js";

export interface MetricsAutoUpdateOptions {
  reportingHours?: number;
  includeDriftDetection?: boolean;
  driftBaselineHours?: number;
  driftRecentHours?: number;
  minRecentRewardSamples?: number;
  rewardDriftThreshold?: number;
  minReputationSamplesPerWindow?: number;
  regressionThreshold?: number;
  rewardFilePath?: string;
  reputationFilePath?: string;
  driftReportPath?: string;
}

export interface MetricsAutoUpdateResult {
  dashboardUpdated: boolean;
  driftReport?: DriftReport;
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
      minReputationSamplesPerWindow: options.minReputationSamplesPerWindow,
      regressionThreshold: options.regressionThreshold,
      rewardFilePath: options.rewardFilePath,
      reputationFilePath: options.reputationFilePath,
      reportPath: options.driftReportPath
    });
  }

  return {
    dashboardUpdated: true,
    driftReport,
    updatedAt: new Date().toISOString()
  };
}

function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main(): Promise<void> {
  const reportingHours = parseOptionalNumber(process.env.SF_AI_METRICS_REPORTING_HOURS) ?? 24;
  const includeDriftDetection =
    parseBooleanFlag(process.env.SF_AI_METRICS_WITH_DRIFT) ||
    process.argv.includes("--with-drift") ||
    process.argv.includes("--drift");

  const result = await runMetricsAutoUpdate({
    reportingHours,
    includeDriftDetection,
    driftBaselineHours: parseOptionalNumber(process.env.SF_AI_DRIFT_BASELINE_HOURS),
    driftRecentHours: parseOptionalNumber(process.env.SF_AI_DRIFT_RECENT_HOURS),
    minRecentRewardSamples: parseOptionalNumber(process.env.SF_AI_DRIFT_MIN_REWARD_SAMPLES),
    rewardDriftThreshold: parseOptionalNumber(process.env.SF_AI_DRIFT_THRESHOLD),
    minReputationSamplesPerWindow: parseOptionalNumber(
      process.env.SF_AI_DRIFT_MIN_REPUTATION_SAMPLES
    ),
    regressionThreshold: parseOptionalNumber(process.env.SF_AI_REGRESSION_THRESHOLD),
    driftReportPath: process.env.SF_AI_DRIFT_REPORT_PATH
  });

  if (result.driftReport?.shouldAlert) {
    console.log(
      `[metrics-auto-update] completed with alerts: ${result.driftReport.alerts.join(" | ")}`
    );
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
