import type { WorkflowEngine } from "../../core/ports/workflow-engine.js";
import {
  getTemporalActivityRetryBackoffCoefficient,
  getTemporalActivityRetryInitialIntervalMs,
  getTemporalActivityRetryMaximumAttempts,
  getTemporalActivityTimeoutSeconds,
  getTemporalAddress,
  getTemporalNamespace,
  getTemporalTaskQueueForCapability,
  getTemporalWorkflowRetryMaximumAttempts,
  getWorkflowEngineMode
} from "../../core/config/runtime-config.js";
import {
  createInProcessWorkflowEngine,
  type CreateInProcessWorkflowEngineOptions
} from "./in-process-workflow-engine.js";
import { createTemporalWorkflowEngine } from "./temporal-workflow-engine.js";
import { resolveEnvMode } from "../../env-schema.js";

function isInProcessWorkflowEscapeHatchEnabled(env: NodeJS.ProcessEnv): boolean {
  const viaNodeEnv = String(env.NODE_ENV ?? "").trim().toLowerCase() === "test";
  const raw = String(env.SF_AI_ALLOW_IN_PROCESS_WORKFLOW ?? "").trim().toLowerCase();
  const viaFlag = raw === "1" || raw === "true";
  return viaNodeEnv || viaFlag;
}

export function createWorkflowEngine(
  options: CreateInProcessWorkflowEngineOptions,
  env: NodeJS.ProcessEnv = process.env
): WorkflowEngine {
  const inProcessEngine = createInProcessWorkflowEngine(options);
  const envMode = resolveEnvMode(env);
  const mode = getWorkflowEngineMode(envMode === "prod" ? "temporal" : "in-process", env);
  const allowInProcessEscapeHatch = isInProcessWorkflowEscapeHatchEnabled(env);

  if (envMode === "prod" && mode !== "temporal") {
    throw new Error("SF_AI_ENV_MODE=prod requires SF_AI_WORKFLOW_ENGINE=temporal");
  }

  if (mode === "in-process" && !allowInProcessEscapeHatch) {
    throw new Error(
      "in-process workflow mode is test-only. Set SF_AI_ALLOW_IN_PROCESS_WORKFLOW=true only for temporary local debugging."
    );
  }

  if (mode === "temporal") {
    return createTemporalWorkflowEngine({
      fallbackEngine: inProcessEngine,
      allowFallbackToInProcess: allowInProcessEscapeHatch,
      temporalAddress: getTemporalAddress("localhost:7233", env),
      temporalNamespace: getTemporalNamespace("default", env),
      taskQueue: getTemporalTaskQueueForCapability("core-orchestration", env),
      workflowRetryMaximumAttempts: getTemporalWorkflowRetryMaximumAttempts(1, env),
      activityTimeoutSeconds: getTemporalActivityTimeoutSeconds(60, env),
      activityRetryMaximumAttempts: getTemporalActivityRetryMaximumAttempts(3, env),
      activityRetryInitialIntervalMs: getTemporalActivityRetryInitialIntervalMs(1000, env),
      activityRetryBackoffCoefficient: getTemporalActivityRetryBackoffCoefficient(2, env)
    });
  }

  return inProcessEngine;
}
