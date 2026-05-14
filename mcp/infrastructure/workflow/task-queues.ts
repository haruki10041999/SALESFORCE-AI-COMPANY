import {
  getTemporalTaskQueueForCapability,
  type TemporalTaskQueueCapability
} from "../../core/config/runtime-config.js";

export const WORKFLOW_TASK_QUEUE_CAPABILITIES: readonly TemporalTaskQueueCapability[] = [
  "core-orchestration",
  "llm-heavy",
  "analysis-heavy",
  "deploy-heavy",
  "scheduler"
];

export type WorkflowTaskQueueMap = Record<TemporalTaskQueueCapability, string>;

export function resolveWorkflowTaskQueues(
  env: NodeJS.ProcessEnv = process.env
): WorkflowTaskQueueMap {
  return {
    "core-orchestration": getTemporalTaskQueueForCapability("core-orchestration", env),
    "llm-heavy": getTemporalTaskQueueForCapability("llm-heavy", env),
    "analysis-heavy": getTemporalTaskQueueForCapability("analysis-heavy", env),
    "deploy-heavy": getTemporalTaskQueueForCapability("deploy-heavy", env),
    scheduler: getTemporalTaskQueueForCapability("scheduler", env)
  };
}
