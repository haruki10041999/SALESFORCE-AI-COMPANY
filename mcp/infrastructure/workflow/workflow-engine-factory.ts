import type { WorkflowEngine } from "../../core/ports/workflow-engine.js";
import {
  getTemporalActivityRetryBackoffCoefficient,
  getTemporalActivityRetryInitialIntervalMs,
  getTemporalActivityRetryMaximumAttempts,
  getTemporalActivityTimeoutSeconds,
  getTemporalAddress,
  getTemporalNamespace,
  getTemporalTaskQueue,
  getTemporalWorkflowRetryMaximumAttempts,
  getWorkflowEngineMode
} from "../../core/config/runtime-config.js";
import {
  createInProcessWorkflowEngine,
  type CreateInProcessWorkflowEngineOptions
} from "./in-process-workflow-engine.js";
import { createTemporalWorkflowEngine } from "./temporal-workflow-engine.js";

export function createWorkflowEngine(
  options: CreateInProcessWorkflowEngineOptions,
  env: NodeJS.ProcessEnv = process.env
): WorkflowEngine {
  const inProcessEngine = createInProcessWorkflowEngine(options);
  const mode = getWorkflowEngineMode("in-process", env);

  if (mode === "temporal") {
    return createTemporalWorkflowEngine({
      fallbackEngine: inProcessEngine,
      temporalAddress: getTemporalAddress("localhost:7233", env),
      temporalNamespace: getTemporalNamespace("default", env),
      taskQueue: getTemporalTaskQueue("sfai-orchestration", env),
      workflowRetryMaximumAttempts: getTemporalWorkflowRetryMaximumAttempts(1, env),
      activityTimeoutSeconds: getTemporalActivityTimeoutSeconds(60, env),
      activityRetryMaximumAttempts: getTemporalActivityRetryMaximumAttempts(3, env),
      activityRetryInitialIntervalMs: getTemporalActivityRetryInitialIntervalMs(1000, env),
      activityRetryBackoffCoefficient: getTemporalActivityRetryBackoffCoefficient(2, env)
    });
  }

  return inProcessEngine;
}
