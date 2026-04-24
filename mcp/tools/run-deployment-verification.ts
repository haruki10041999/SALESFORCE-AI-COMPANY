import { promises as fsPromises } from "node:fs";
import { join, resolve } from "node:path";
import { buildTestCommand } from "./run-tests.js";

export type VerificationAction = "rollback" | "continue" | "monitor";

export type SmokeTestResult = {
  totalTests: number;
  passedTests?: number;
  failedTests: number;
  skippedTests?: number;
  criticalFailures?: number;
};

export type RunDeploymentVerificationInput = {
  targetOrg: string;
  dryRun?: boolean;
  deploymentSucceeded?: boolean;
  smokeClassNames?: string[];
  smokeSuiteName?: string;
  wait?: number;
  outputDir?: string;
  smokeResult?: SmokeTestResult;
  failureRateThresholdPercent?: number;
  criticalFailureThreshold?: number;
  reportOutputDir?: string;
};

export type RunDeploymentVerificationResult = {
  mode: "dry-run" | "live";
  generatedAt: string;
  targetOrg: string;
  smokeTestCommand: string;
  deployment: {
    succeeded: boolean;
  };
  smokeTest: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
    criticalFailures: number;
    failureRatePercent: number;
  };
  thresholds: {
    failureRateThresholdPercent: number;
    criticalFailureThreshold: number;
  };
  decision: {
    recommendedAction: VerificationAction;
    shouldRollback: boolean;
    reason: string;
  };
  reportJsonPath: string;
  reportMarkdownPath: string;
  summary: string;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeSmokeResult(input?: SmokeTestResult): {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  criticalFailures: number;
} {
  if (!input) {
    return {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      criticalFailures: 0
    };
  }

  const totalTests = Math.max(0, Math.floor(input.totalTests));
  const failedTests = Math.max(0, Math.floor(input.failedTests));
  const skippedTests = Math.max(0, Math.floor(input.skippedTests ?? 0));
  const criticalFailures = Math.max(0, Math.floor(input.criticalFailures ?? 0));

  const impliedPassed = Math.max(0, totalTests - failedTests - skippedTests);
  const passedTests = Math.max(0, Math.floor(input.passedTests ?? impliedPassed));
  const normalizedTotal = Math.max(totalTests, passedTests + failedTests + skippedTests);

  return {
    totalTests: normalizedTotal,
    passedTests,
    failedTests,
    skippedTests,
    criticalFailures
  };
}

function renderMarkdown(result: RunDeploymentVerificationResult): string {
  const lines: string[] = [];
  lines.push("# Deployment Verification Report");
  lines.push("");
  lines.push(`- mode: ${result.mode}`);
  lines.push(`- generatedAt: ${result.generatedAt}`);
  lines.push(`- targetOrg: ${result.targetOrg}`);
  lines.push(`- deploymentSucceeded: ${result.deployment.succeeded}`);
  lines.push(`- recommendedAction: ${result.decision.recommendedAction}`);
  lines.push(`- shouldRollback: ${result.decision.shouldRollback}`);
  lines.push("");
  lines.push("## Smoke Test");
  lines.push("");
  lines.push(`- totalTests: ${result.smokeTest.totalTests}`);
  lines.push(`- passedTests: ${result.smokeTest.passedTests}`);
  lines.push(`- failedTests: ${result.smokeTest.failedTests}`);
  lines.push(`- skippedTests: ${result.smokeTest.skippedTests}`);
  lines.push(`- criticalFailures: ${result.smokeTest.criticalFailures}`);
  lines.push(`- failureRatePercent: ${result.smokeTest.failureRatePercent.toFixed(2)}`);
  lines.push("");
  lines.push("## Command");
  lines.push("");
  lines.push(`- ${result.smokeTestCommand}`);
  lines.push("");
  lines.push("## Decision");
  lines.push("");
  lines.push(`- reason: ${result.decision.reason}`);
  return lines.join("\n");
}

export async function runDeploymentVerification(
  input: RunDeploymentVerificationInput
): Promise<RunDeploymentVerificationResult> {
  const dryRun = input.dryRun ?? true;
  const deploymentSucceeded = input.deploymentSucceeded ?? true;
  const failureRateThresholdPercent = clampNumber(
    Number.isFinite(input.failureRateThresholdPercent)
      ? input.failureRateThresholdPercent as number
      : 5,
    0,
    100
  );
  const criticalFailureThreshold = Math.max(
    0,
    Math.floor(Number.isFinite(input.criticalFailureThreshold) ? input.criticalFailureThreshold as number : 1)
  );

  const smokeTestCommand = buildTestCommand({
    targetOrg: input.targetOrg,
    classNames: input.smokeClassNames,
    suiteName: input.smokeSuiteName,
    wait: input.wait,
    outputDir: input.outputDir
  });

  if (!dryRun && !input.smokeResult && deploymentSucceeded) {
    throw new Error("smokeResult is required when dryRun is false and deploymentSucceeded is true");
  }

  const smoke = normalizeSmokeResult(input.smokeResult);
  const failureRatePercent =
    smoke.totalTests > 0 ? (smoke.failedTests / smoke.totalTests) * 100 : (smoke.failedTests > 0 ? 100 : 0);

  let recommendedAction: VerificationAction = "monitor";
  let reason = "dry-run mode: execute smoke tests and provide actual results";

  if (!deploymentSucceeded) {
    recommendedAction = "rollback";
    reason = "deployment status indicates failure";
  } else if (!dryRun) {
    if (smoke.criticalFailures >= criticalFailureThreshold && smoke.criticalFailures > 0) {
      recommendedAction = "rollback";
      reason = `critical failures reached threshold (${smoke.criticalFailures} >= ${criticalFailureThreshold})`;
    } else if (smoke.totalTests === 0) {
      recommendedAction = "monitor";
      reason = "no smoke test results available; continue monitoring before full rollout";
    } else if (smoke.failedTests === 0) {
      recommendedAction = "continue";
      reason = "smoke tests passed without failures";
    } else if (failureRatePercent > failureRateThresholdPercent) {
      recommendedAction = "rollback";
      reason = `failure rate exceeded threshold (${failureRatePercent.toFixed(2)}% > ${failureRateThresholdPercent}%)`;
    } else {
      recommendedAction = "monitor";
      reason = `smoke tests have partial failures (${failureRatePercent.toFixed(2)}%), below rollback threshold`;
    }
  }

  const generatedAt = new Date().toISOString();
  const reportDir = resolve(input.reportOutputDir ?? join("outputs", "reports"));
  await fsPromises.mkdir(reportDir, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const reportJsonPath = join(reportDir, `deployment-verification-${stamp}.json`);
  const reportMarkdownPath = join(reportDir, `deployment-verification-${stamp}.md`);

  const result: RunDeploymentVerificationResult = {
    mode: dryRun ? "dry-run" : "live",
    generatedAt,
    targetOrg: input.targetOrg,
    smokeTestCommand,
    deployment: {
      succeeded: deploymentSucceeded
    },
    smokeTest: {
      ...smoke,
      failureRatePercent
    },
    thresholds: {
      failureRateThresholdPercent,
      criticalFailureThreshold
    },
    decision: {
      recommendedAction,
      shouldRollback: recommendedAction === "rollback",
      reason
    },
    reportJsonPath,
    reportMarkdownPath,
    summary: [
      `mode: ${dryRun ? "dry-run" : "live"}`,
      `deploymentSucceeded: ${deploymentSucceeded}`,
      `failedTests: ${smoke.failedTests}`,
      `failureRatePercent: ${failureRatePercent.toFixed(2)}`,
      `recommendedAction: ${recommendedAction}`
    ].join("\n")
  };

  await fsPromises.writeFile(reportJsonPath, JSON.stringify(result, null, 2), "utf-8");
  await fsPromises.writeFile(reportMarkdownPath, renderMarkdown(result), "utf-8");

  return result;
}
