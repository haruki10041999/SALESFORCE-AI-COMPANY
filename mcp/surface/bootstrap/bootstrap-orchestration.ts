import {
  createChatToolRunner,
  createPolicySnapshotManager
} from "../../core/application/orchestration/bootstrap-adapters.js";
import { createOrchestrationQueueStore } from "../../infrastructure/workflow/orchestration-queue-store.js";
import { createOrchestrationJobRunner } from "../../infrastructure/workflow/orchestration-job-runner.js";
import { createWorkflowEngine } from "../../infrastructure/workflow/workflow-engine-factory.js";

export interface StartOrchestrationBootstrapOptions {
  rootDir: string;
  stateBackend: "sqlite" | "postgres";
  databaseUrl?: string;
  outputsDir: string;
  banditStateFile: string;
  listSkills: () => { name: string; summary: string }[];
  filterDisabledSkills: (skillNames: string[]) => Promise<{ enabled: string[]; disabled: string[] }>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  buildChatPrompt: (
    topic: string,
    agentNames: string[],
    personaName: string | undefined,
    skillNames: string[],
    filePaths: string[],
    turns: number,
    maxContextChars?: number,
    appendInstruction?: string,
    includeProjectContext?: boolean
  ) => Promise<string>;
}

export async function startOrchestrationBootstrap(options: StartOrchestrationBootstrapOptions) {
  const runChatTool = createChatToolRunner({
    listSkills: options.listSkills,
    filterDisabledSkills: options.filterDisabledSkills,
    emitSystemEvent: options.emitSystemEvent,
    buildChatPrompt: options.buildChatPrompt
  });

  const orchestrationQueueStore = await createOrchestrationQueueStore({
    stateBackend: options.stateBackend,
    databaseUrl: options.databaseUrl,
    queuePrefix: "orchestration-session"
  });

  const orchestrationJobRunner = createOrchestrationJobRunner({
    stateBackend: options.stateBackend,
    databaseUrl: options.databaseUrl
  });

  const workflowEngine = createWorkflowEngine({
    orchestrationQueueStore,
    orchestrationJobRunner
  });

  const policySnapshotManager = createPolicySnapshotManager({
    banditStateFile: options.banditStateFile,
    agentReputationFile: `${options.outputsDir}/agent-reputation.jsonl`,
    databaseUrl: options.databaseUrl,
    debounceMs: 200
  });

  return {
    runChatTool,
    orchestrationQueueStore,
    orchestrationJobRunner,
    workflowEngine,
    policySnapshotManager
  };
}
