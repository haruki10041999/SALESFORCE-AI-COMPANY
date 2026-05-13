// .env ��S���W���[�����O�ɓǂݍ��� (����p import)�B
// ����: ESM �� import �͐錾���ɕ]������邽�߁A�K���g�b�v�ɔz�u���邱�ƁB
import "./env-loader.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "path";
import { AppError } from "./core/errors/messages.js";
import {
  initializeServerRuntime as initializeServerRuntimeModule,
  registerServerTools,
  startMcpTransport,
  runWithLifecycle
} from "./surface/index.js";
import type { HandlerContext } from "./core/application/handler-context.js";
import type { ToolDefinition } from "./core/registry/define-tool.js";

// ============================================================
// Core Modules
// ============================================================
import { scoreByQuery } from "./core/resource/topic-skill-ranking.js";
import {
  findMdFilesRecursive,
  toPosixPath,
  truncateContent,
  listMdFiles as listMdFilesFromCatalog,
  getMdFile as getMdFileFromCatalog,
  getMdFileAsync as getMdFileAsyncFromCatalog
} from "./core/context/markdown-catalog.js";
import { createCustomToolRegistry } from "./core/resource/custom-tool-registry.js";
import { emitEvent } from "./core/event/event-dispatcher.js";
import {
  createSystemEventManager,
  summarizeValue,
  type SystemEventName
} from "./core/event/system-event-manager.js";

// ============================================================
// Phase 5: Handlers Auto-Initialization
// ============================================================
import {
  initializeHandlersState,
  autoInitializeHandlers
} from "./handlers/auto-init.js";

// ============================================================
// Memory / Observability / Statistics
// ============================================================
import {
  addMemory,
  searchMemory,
  listMemory,
  clearMemory,
  recordFailureMemory,
  searchFailureMemory,
  listFailureMemory,
  ingestKnowledgeSummary,
  addRecord,
  searchByKeyword,
  searchByKeywordAsync
} from "./core/memory/index.js";
import { buildPrompt } from "./core/prompt/prompt-builder.js";
import { evaluatePromptMetrics } from "./core/prompt/prompt-evaluator.js";
import {
  exportStatisticsAsCsv,
  exportStatisticsAsJson
} from "./handlers/statistics-manager.js";
import type { HandlersDashboardState } from "./core/types/index.js";
import {
  checkDailyLimitExceeded
} from "./core/governance/governance-manager.js";
import { createOperationLog } from "./core/governance/operation-log.js";
import { createGovernedToolRegistrar } from "./core/governance/governed-tool-registrar.js";
import { createGovernanceEventAutomationManager } from "./core/governance/governance-event-automation.js";
import { createDisabledResourceFilter } from "./core/governance/disabled-resource-filter.js";
import { createDisabledToolsCacheManager } from "./core/governance/disabled-tools-cache.js";
import { CostLedgerManager } from "./core/governance/cost-ledger-manager.js";
import { createGovernanceStateManager } from "./core/governance/governance-state-manager.js";
import { resolveStateBackend } from "./core/persistence/state-store.js";
import {
  type GovernanceState
} from "./core/governance/governance-state.js";
import { createPresetStore } from "./core/context/preset-store.js";
import { createHistoryStore } from "./core/context/history-store.js";
import { PostgresSessionStore } from "./core/persistence/session-store.postgres.js";
import { SqliteSessionStore } from "./core/persistence/session-store.sqlite.js";
import type { SessionStore } from "./core/persistence/session-store.js";
import { PostgresEventStore } from "./core/persistence/postgres-event-store.js";
import { createOrchestrationQueueStore } from "./infrastructure/workflow/orchestration-queue-store.js";
import { createOrchestrationJobRunner } from "./infrastructure/workflow/orchestration-job-runner.js";
import { createWorkflowEngine } from "./infrastructure/workflow/workflow-engine-factory.js";
import {
  createTemporalWorkflowWorker,
  type TemporalWorkflowWorkerHandle
} from "./infrastructure/workflow/temporal-workflow-worker.js";
import { createTemporalWorkflowActivities } from "./infrastructure/workflow/temporal-workflow-activities.js";
import { createPolicySnapshotManager } from "./core/learning/policy-snapshot.js";
import { runMetricsAutoUpdate } from "./core/learning/metrics-auto-update.js";
import { createPromptRenderer } from "./core/context/prompt-rendering.js";
import { isEnvFlagEnabled, parseBooleanLike } from "./core/config/env-flags.js";
import { evaluatePseudoHooks as evaluatePseudoHooksCore } from "./core/orchestration/pseudo-hooks.js";
import { createChatToolRunner, generateSessionId } from "./core/orchestration/chat-tool-runner.js";
import { clearOrchestrationSessionsForTest } from "./core/orchestration/session-registry.js";
import { chatInputSchema, triggerRuleSchema } from "./core/orchestration/schemas.js";
import { getDefaultSchedulesFilePath, loadCleanupSchedules } from "./core/resource/cleanup-scheduler.js";
import { LeaderElection } from "./core/reliability/leader-election.js";
import type { SystemEventType } from "./core/event/event-dispatcher.js";
import { createLogger } from "./core/logging/logger.js";
import {
  getMetricsAutoUpdateEnvConfig,
  getLowRelevanceScoreThreshold,
  getTemporalAddress,
  getTemporalNamespace,
  getTemporalRunWorkerEnabled,
  getTemporalTaskQueue,
  getWorkflowEngineMode
} from "./core/config/runtime-config.js";
import { startObservabilityRuntime } from "./core/observability/runtime.js";
import {
  createBanditState,
  loadBanditState,
  saveBanditState
} from "./core/learning/rl-feedback.js";
import { createServerResourceDeps } from "./server-resource-deps.js";
import { resolveServerRuntimePaths } from "./core/server/server-runtime-paths.js";
import { createShutdownStatePersistence } from "./core/server/shutdown-state-persistence.js";
import {
  createProposalQueueStore,
  resolveProposalQueueBackend,
  type ProposalQueueStore
} from "./core/resource/proposal/proposal-queue-store.js";
import { createDbClient } from "../db/client.js";

const {
  root: ROOT,
  outputsDir: OUTPUTS_DIR,
  stateDbPath: STATE_DB_PATH,
  banditStateFile: BANDIT_STATE_FILE,
  startupWarnings: outputsDirStartupWarnings
} = resolveServerRuntimePaths(import.meta.url, process.env);
const logger = createLogger("Server");

// Log environment variables for debugging output directory configuration
logger.debug(`SF_AI_OUTPUTS_DIR env: ${process.env.SF_AI_OUTPUTS_DIR || "(not set)"}`);
logger.debug(`Resolved OUTPUTS_DIR: ${OUTPUTS_DIR}`);
logger.debug(`process.cwd(): ${process.cwd()}`);
for (const warning of outputsDirStartupWarnings) {
  logger.warn(warning);
}

let banditState = createBanditState();

function listMdFiles(dir: string): { name: string; summary: string }[] {
  return listMdFilesFromCatalog(ROOT, dir);
}

function getMdFile(dir: string, name: string): string {
  return getMdFileFromCatalog(ROOT, dir, name);
}

function getMdFileAsync(dir: string, name: string): Promise<string> {
  return getMdFileAsyncFromCatalog(ROOT, dir, name);
}

function truncatePromptContent(text: string, maxChars: number, label?: string): string {
  return truncateContent(text, maxChars, label ?? "");
}

// TASK-F2: prompt rendering wired through a single facade so server.ts stays
// focused on tool registration and lifecycle, not prompt composition details.
const { buildChatPrompt, buildChatPromptCompat: buildChatPromptForTools } = createPromptRenderer({
  root: ROOT,
  findMdFilesRecursive,
  toPosixPath,
  truncateContent: truncatePromptContent,
  getMdFileAsync
});

function isCoreEventForwardable(event: SystemEventName): event is Extract<SystemEventName, SystemEventType> {
  return event === "error_aggregate_detected" || event === "governance_threshold_exceeded";
}

async function emitSystemEventFromTools(event: string, payload: Record<string, unknown>): Promise<void> {
  await emitSystemEvent(event as SystemEventName, payload);
}

// �G�[�W�F���g���b�Z�[�W���O
interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
  topic?: string;
}

const agentLog: AgentMessage[] = [];
const handlersState = initializeHandlersState();
const generateHandlersDashboardState = (state: HandlersDashboardState): HandlersDashboardState => ({
  createdTracker: state.createdTracker,
  deletedTracker: state.deletedTracker,
  errorTracker: state.errorTracker,
  qualityTracker: state.qualityTracker
});
// NOTE: Postgres �x�[�X�ł̓t�@�C���x�[�X�̃��O�͕s�v�iaudit_logs �e�[�u���g�p�j
const { loadRecentOperations, appendOperationLog } = createOperationLog({
  logFile: "",
  ensureDir,
  databaseUrl: process.env.DATABASE_URL
});
const LOW_RELEVANCE_SCORE_THRESHOLD = getLowRelevanceScoreThreshold();
const DEFAULT_PROTECTED_TOOLS = [
  "apply_resource_actions",
  "get_resource_governance",
  "review_resource_governance",
  "record_resource_signal",
  "get_system_events",
  "get_event_automation_config",
  "update_event_automation_config"
];
const GOVERNANCE_FILE = join(OUTPUTS_DIR, "resource-governance.json");
const GOVERNANCE_STORAGE_PATH = STATE_DB_PATH;
const STATE_BACKEND = resolveStateBackend(process.env.SF_AI_STATE_BACKEND);
const DATABASE_URL = process.env.DATABASE_URL;
const costLedgerManager = DATABASE_URL ? new CostLedgerManager(createDbClient(DATABASE_URL)) : null;
const PROPOSAL_QUEUE_BACKEND = resolveProposalQueueBackend(process.env.SF_AI_PROPOSAL_QUEUE_BACKEND, STATE_BACKEND);
const TOOL_PROPOSALS_DIR = join(OUTPUTS_DIR, "tool-proposals");
const CUSTOM_TOOLS_DIR = join(OUTPUTS_DIR, "custom-tools");
const governanceStateManager = createGovernanceStateManager({
  defaultProtectedTools: DEFAULT_PROTECTED_TOOLS,
  governanceFile: GOVERNANCE_FILE,
    ensureDir,
  sqliteDbPath: STATE_DB_PATH,
  stateBackend: STATE_BACKEND,
  databaseUrl: DATABASE_URL
});
const buildDefaultGovernanceState = () => governanceStateManager.buildDefaultGovernanceState();
const loadGovernanceState = () => governanceStateManager.loadGovernanceState();
const saveGovernanceState = (state: GovernanceState) => governanceStateManager.saveGovernanceState(state);
const normalizeDisabledEntries = (names: string[]) => governanceStateManager.normalizeDisabledEntries(names);
const normalizeProtectedTools = (names: string[]) => governanceStateManager.normalizeProtectedTools(names);

const { emitSystemEvent, loadSystemEvents, registerToolFailure, getSystemEventLogStatus } = createSystemEventManager({
  rootDir: ROOT,
  outputsDir: OUTPUTS_DIR,
  databaseUrl: DATABASE_URL,
  ensureDir,
  applyEventAutomation,
  forwardCoreEvent: async (event: SystemEventName, timestamp: string, payload: Record<string, unknown>) => {
    if (isCoreEventForwardable(event)) {
      await emitEvent({
        type: event,
        timestamp,
        payload
      });
    }
  }
});

const server = new McpServer({
  name: "salesforce-ai-company",
  version: "1.0.0"
});

type RegisteredToolHandler = (input: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;

const registeredToolHandlers = new Map<string, RegisteredToolHandler>();
const registeredToolMetadata = new Map<string, { title?: string; description?: string; tags?: string[] }>();
const registeredToolDefinitions = new Map<string, ToolDefinition>();
const registerToolOriginal = server.registerTool.bind(server);

(server as unknown as {
  registerTool: typeof server.registerTool;
}).registerTool = ((
  name: string,
  config: Parameters<typeof server.registerTool>[1],
  handler: Parameters<typeof server.registerTool>[2]
) => {
  registeredToolHandlers.set(name, handler as RegisteredToolHandler);
  registeredToolMetadata.set(name, {
    title: (config as { title?: string })?.title,
    description: (config as { description?: string })?.description,
    tags: (config as { tags?: string[] })?.tags
  });
  return registerToolOriginal(name, config, handler);
}) as typeof server.registerTool;

export function listRegisteredToolNamesForTest(): string[] {
  return [...registeredToolHandlers.keys()].sort();
}

export function listRegisteredToolDefinitionsForTest(): ToolDefinition[] {
  return [...registeredToolDefinitions.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function invokeRegisteredToolForTest(name: string, input: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
  const handler = registeredToolHandlers.get(name);
  if (!handler) {
    // TASK-F8: localized error with stable code for downstream classification.
    throw new AppError("TOOL_NOT_FOUND", { name });
  }
  return handler(input);
}

export { clearOrchestrationSessionsForTest };

// ============================================================
// �K�o�i���X�Ή��c�[���o�^���b�p�[�idisable �`�F�b�N�t���j
// ============================================================

const disabledToolsCache = createDisabledToolsCacheManager({
  governanceFilePath: GOVERNANCE_STORAGE_PATH,
  logger,
  loadGovernanceState,
  normalizeResourceName,
  stateBackend: STATE_BACKEND,
  databaseUrl: DATABASE_URL
});

const costLedger = costLedgerManager
  ? {
      async record(input: {
        toolName: string;
        costUsd: number;
        inputTokens?: number;
        outputTokens?: number;
        actorId?: string;
        tenantId?: string;
        sessionId?: string;
        traceId?: string;
        model?: string;
        status?: "success" | "error" | "blocked";
        metadata?: Record<string, unknown>;
      }): Promise<void> {
        await costLedgerManager.recordCost({
          toolName: input.toolName,
          actorId: input.actorId ?? "system",
          model: input.model ?? "mistral",
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          tenantId: input.tenantId,
          sessionId: input.sessionId,
          traceId: input.traceId,
          status: input.status ?? "success"
        });
      }
    }
  : {
      async record(): Promise<void> {
        return;
      }
    };

const { govTool } = createGovernedToolRegistrar({
  registerTool: (name, config, handler) => {
    server.registerTool(
      name,
      config as Parameters<typeof server.registerTool>[1],
      handler as Parameters<typeof server.registerTool>[2]
    );
  },
  isToolDisabled: (toolName: string) => {
    return disabledToolsCache.isToolDisabled(toolName);
  },
  normalizeResourceName,
  outputsDir: OUTPUTS_DIR,
  databaseUrl: DATABASE_URL,
  costLedger,
  serverRoot: ROOT,
  emitSystemEvent: emitSystemEventFromTools,
  summarizeValue,
  registerToolFailure,
  getBanditState: () => banditState,
  banditStateFile: BANDIT_STATE_FILE,
  onToolDefined: (definition) => {
    registeredToolDefinitions.set(definition.name, definition);
  },
  getRetryConfig: async () => {
    const state = await loadGovernanceState();
    return state.config.toolExecution;
  }
});



const disabledResourceFilter = createDisabledResourceFilter({
  loadGovernanceState,
  toPosixPath
});

function normalizeResourceName(name: string): string {
  return disabledResourceFilter.normalizeResourceName(name);
}

async function filterDisabledSkills(skillNames: string[]): Promise<{ enabled: string[]; disabled: string[] }> {
  return disabledResourceFilter.filterDisabledSkills(skillNames);
}

async function isPresetDisabled(presetName: string): Promise<boolean> {
  return disabledResourceFilter.isPresetDisabled(presetName);
}

const runChatTool = createChatToolRunner({
  listSkills: () => listMdFiles("skills"),
  filterDisabledSkills,
  emitSystemEvent: emitSystemEventFromTools,
  buildChatPrompt
});

const HISTORY_DIR = join(OUTPUTS_DIR, "history");
const USE_SQLITE_HISTORY = isEnvFlagEnabled("SF_AI_HISTORY_SQLITE");
const ALLOW_HISTORY_FILE_FALLBACK = isEnvFlagEnabled("SF_AI_HISTORY_FILE_FALLBACK");
const ALLOW_PRESET_FILE_FALLBACK = isEnvFlagEnabled("SF_AI_PRESET_FILE_FALLBACK");
// NOTE: Postgres �x�[�X�ł̓f�B���N�g���x�[�X�̗����Ǘ��͕s�v
// ���ׂ� Postgres state_records �e�[�u���ɕۑ������
const PRESETS_DIR = join(OUTPUTS_DIR, "presets");
const HISTORY_RETENTION_DAYS = 30;
const HISTORY_MAX_FILES = 200;
const SESSION_RETENTION_DAYS = 30;

// NOTE: Postgres �x�[�X�ł� ensureDir �͕s�v�����A
// �������W���[���݊����̂��� dummy �������
async function ensureDir(_dir: string): Promise<void> {
  // No-op: Postgres �x�[�X�ł� dir creation �͕s�v
}

const { createPreset, listPresetsData, getPreset } = createPresetStore({
  presetsDir: PRESETS_DIR,
  ensureDir,
  allowFileFallback: ALLOW_PRESET_FILE_FALLBACK
});
const { saveChatHistory, saveSessionHistory, loadChatHistories, restoreChatHistory } = createHistoryStore({
  historyDir: HISTORY_DIR,
  ensureDir,
  agentLog,
  maxHistoryFiles: HISTORY_MAX_FILES,
  retentionDays: HISTORY_RETENTION_DAYS,
  allowFileFallback: ALLOW_HISTORY_FILE_FALLBACK,
  sqlite: {
    enabled: USE_SQLITE_HISTORY,
    dbPath: STATE_DB_PATH
  }
});
const sessionStore: SessionStore = STATE_BACKEND === "postgres" && DATABASE_URL
  ? await PostgresSessionStore.open({
      databaseUrl: DATABASE_URL,
      retentionDays: SESSION_RETENTION_DAYS
    })
  : SqliteSessionStore.open({
      dbPath: STATE_DB_PATH,
      retentionDays: SESSION_RETENTION_DAYS
    });
const orchestrationQueueStore = await createOrchestrationQueueStore({
  stateBackend: STATE_BACKEND,
  databaseUrl: DATABASE_URL,
  queuePrefix: "orchestration-session"
});
const orchestrationJobRunner = createOrchestrationJobRunner({
  stateBackend: STATE_BACKEND,
  databaseUrl: DATABASE_URL
});
const workflowEngine = createWorkflowEngine({
  orchestrationQueueStore,
  orchestrationJobRunner
});
const policySnapshotManager = createPolicySnapshotManager({
  banditStateFile: BANDIT_STATE_FILE,
  agentReputationFile: join(OUTPUTS_DIR, "agent-reputation.jsonl"),
  databaseUrl: DATABASE_URL,
  debounceMs: 200
});
const proposalQueue: ProposalQueueStore = await createProposalQueueStore({
  backend: PROPOSAL_QUEUE_BACKEND,
  outputsDir: OUTPUTS_DIR,
  databaseUrl: DATABASE_URL
});
const leaderElection = LeaderElection.open({
  databaseUrl: DATABASE_URL,
  enabled: isEnvFlagEnabled("SF_AI_LEADER_ELECTION_ENABLED", process.env, true),
  lockNamespace: "sfai:leader",
  instanceId: process.env.SF_AI_INSTANCE_ID
});

if (
  PROPOSAL_QUEUE_BACKEND === "pg-boss" &&
  typeof proposalQueue.scheduleRecurringJob === "function" &&
  typeof proposalQueue.unscheduleRecurringJob === "function"
) {
  const scheduleRecurringJob = proposalQueue.scheduleRecurringJob.bind(proposalQueue);
  const unscheduleRecurringJob = proposalQueue.unscheduleRecurringJob.bind(proposalQueue);

  try {
    await leaderElection.runIfLeader({
      lockKey: "governance-auto-cleanup:start-sync",
      onLeader: async () => {
        const cleanupSchedules = await loadCleanupSchedules(getDefaultSchedulesFilePath(ROOT));
        for (const schedule of cleanupSchedules.schedules) {
          if (schedule.status !== "active") {
            await unscheduleRecurringJob({
              queue: "governance-auto-cleanup",
              key: schedule.id
            });
            continue;
          }

          await scheduleRecurringJob({
            queue: "governance-auto-cleanup",
            cron: schedule.cron,
            key: schedule.id,
            data: {
              scheduleId: schedule.id,
              action: schedule.action,
              daysUnused: schedule.daysUnused,
              limit: schedule.limit,
              requireApproval: schedule.requireApproval
            }
          });
        }
        logger.info("cleanup schedule startup sync completed as leader");
      },
      onFollower: async () => {
        logger.info(
          `cleanup schedule startup sync skipped (not leader, instance=${leaderElection.describeInstance()})`
        );
      }
    });
  } catch (error) {
    logger.warn(`cleanup schedule startup sync failed: ${summarizeValue(error, 300)}`);
  }
}

const { loadedCustomToolNames, registerCustomTool, unregisterCustomTool, loadCustomToolsFromDir } = createCustomToolRegistry({
  govTool,
  filterDisabledSkills,
  buildChatPrompt: buildChatPromptForTools
});

const {
  listSkillsCatalog,
  listPresetsCatalog,
  listToolsCatalog,
  resourceScore,
  validateAndCreateSkillWithQuality,
  validateAndCreatePresetWithQuality,
  validateAndCreateToolWithQuality
} = createServerResourceDeps({
  root: ROOT,
  findMdFilesRecursive,
  toPosixPath,
  listPresetsData,
  loadedCustomToolNames,
  listRegisteredToolNames: () => [...registeredToolMetadata.keys()]
});

const governanceEventAutomation = createGovernanceEventAutomationManager({
  loadGovernanceState,
  saveGovernanceState,
  normalizeResourceName,
  normalizeDisabledEntries,
  normalizeProtectedTools,
  refreshDisabledToolsCache: () => disabledToolsCache.refresh("event-automation"),
  getDefaultEventAutomationConfig: () => buildDefaultGovernanceState().config.eventAutomation,
  summarizeError: summarizeValue
});

async function applyEventAutomation(event: SystemEventName, payload: Record<string, unknown>): Promise<void> {
  await governanceEventAutomation.applyEventAutomation(event, payload);
}

type RegisterServerToolsOptions = Parameters<typeof registerServerTools>[0];

const toolCoreDeps = {
  govTool,
  chatInputSchema,
  triggerRuleSchema,
  root: ROOT,
  agentLog
} satisfies Pick<RegisterServerToolsOptions, "govTool" | "chatInputSchema" | "triggerRuleSchema" | "root" | "agentLog">;

const chatAndSessionDeps = {
  runChatTool,
  generateSessionId,
  filterDisabledSkills,
  emitSystemEvent: emitSystemEventFromTools,
  buildChatPrompt: buildChatPromptForTools,
  evaluatePseudoHooks: evaluatePseudoHooksCore,
  sessionStore,
  orchestrationQueueStore,
  orchestrationJobRunner,
  workflowEngine,
  policySnapshotManager,
  saveSessionHistory,
  onSessionCompleted: async ({ sessionId, topic, history }) => {
    if (!history || history.length === 0) {
      return null;
    }

    const lines = [
      `session: ${sessionId}`,
      `topic: ${topic}`,
      ...history.slice(-30).map((entry) => `${entry.agent}: ${entry.message}`)
    ];

    const result = ingestKnowledgeSummary(lines.join("\n"));
    return {
      entities: result.entities.length,
      relations: result.relations.length
    };
  }
} satisfies Pick<
  RegisterServerToolsOptions,
  | "runChatTool"
  | "generateSessionId"
  | "filterDisabledSkills"
  | "emitSystemEvent"
  | "buildChatPrompt"
  | "evaluatePseudoHooks"
  | "sessionStore"
  | "orchestrationQueueStore"
  | "orchestrationJobRunner"
  | "workflowEngine"
  | "policySnapshotManager"
  | "saveSessionHistory"
  | "onSessionCompleted"
>;

const governanceAndEventDeps = {
  loadSystemEvents,
  loadGovernanceState,
  saveGovernanceState,
  buildDefaultGovernanceState,
  normalizeProtectedTools,
  getSystemEventLogStatus,
  generateHandlersDashboard: generateHandlersDashboardState,
  handlersState,
  exportStatisticsAsCsv,
  exportStatisticsAsJson,
  loadRecentOperations,
  checkDailyLimitExceeded,
  appendOperationLog,
  emitEvent,
  resourceScore,
  proposalQueue
} satisfies Pick<
  RegisterServerToolsOptions,
  | "loadSystemEvents"
  | "loadGovernanceState"
  | "saveGovernanceState"
  | "buildDefaultGovernanceState"
  | "normalizeProtectedTools"
  | "getSystemEventLogStatus"
  | "generateHandlersDashboard"
  | "handlersState"
  | "exportStatisticsAsCsv"
  | "exportStatisticsAsJson"
  | "loadRecentOperations"
  | "checkDailyLimitExceeded"
  | "appendOperationLog"
  | "emitEvent"
  | "resourceScore"
  | "proposalQueue"
>;

const presetAndPromptDeps = {
  saveChatHistory,
  loadChatHistories,
  restoreChatHistory,
  listMdFiles,
  getMdFile,
  listPresetsData,
  scoreByQuery,
  lowRelevanceScoreThreshold: LOW_RELEVANCE_SCORE_THRESHOLD,
  registeredToolMetadata,
  createPreset,
  getPreset,
  isPresetDisabled,
  buildPrompt,
  evaluatePromptMetrics
} satisfies Pick<
  RegisterServerToolsOptions,
  | "saveChatHistory"
  | "loadChatHistories"
  | "restoreChatHistory"
  | "listMdFiles"
  | "getMdFile"
  | "listPresetsData"
  | "scoreByQuery"
  | "lowRelevanceScoreThreshold"
  | "registeredToolMetadata"
  | "createPreset"
  | "getPreset"
  | "isPresetDisabled"
  | "buildPrompt"
  | "evaluatePromptMetrics"
>;

const memoryAndIoDeps = {
  ensureDir,
  addMemory,
  searchMemory,
  listMemory,
  clearMemory,
  recordFailureMemory,
  searchFailureMemory,
  listFailureMemory,
  presetsDir: PRESETS_DIR,
  toolProposalsDir: TOOL_PROPOSALS_DIR,
  customToolsDir: CUSTOM_TOOLS_DIR,
  governanceFile: GOVERNANCE_FILE
} satisfies Pick<
  RegisterServerToolsOptions,
  | "ensureDir"
  | "addMemory"
  | "searchMemory"
  | "listMemory"
  | "clearMemory"
  | "recordFailureMemory"
  | "searchFailureMemory"
  | "listFailureMemory"
  | "presetsDir"
  | "toolProposalsDir"
  | "customToolsDir"
  | "governanceFile"
>;

const searchAndCatalogDeps = {
  findMdFilesRecursive,
  toPosixPath,
  addRecord,
  searchByKeyword,
  searchByKeywordAsync,
  listSkillsCatalog,
  listPresetsCatalog,
  listToolsCatalog,
  validateAndCreateSkillWithQuality,
  validateAndCreatePresetWithQuality,
  validateAndCreateToolWithQuality
} satisfies Pick<
  RegisterServerToolsOptions,
  | "findMdFilesRecursive"
  | "toPosixPath"
  | "addRecord"
  | "searchByKeyword"
  | "searchByKeywordAsync"
  | "listSkillsCatalog"
  | "listPresetsCatalog"
  | "listToolsCatalog"
  | "validateAndCreateSkillWithQuality"
  | "validateAndCreatePresetWithQuality"
  | "validateAndCreateToolWithQuality"
>;

const customToolDeps = {
  registerCustomTool,
  unregisterCustomTool,
  refreshDisabledToolsCache: () => disabledToolsCache.refresh("tool-call")
} satisfies Pick<RegisterServerToolsOptions, "registerCustomTool" | "unregisterCustomTool" | "refreshDisabledToolsCache">;

const { handlerContext } = registerServerTools({
  ...toolCoreDeps,
  ...chatAndSessionDeps,
  ...governanceAndEventDeps,
  ...presetAndPromptDeps,
  ...memoryAndIoDeps,
  ...searchAndCatalogDeps,
  ...customToolDeps
});

export function getHandlerContextForTest(): HandlerContext {
  return handlerContext;
}

// Backward compatible alias for existing tests/helpers.
export const getHandlerContextBridgeForTest = getHandlerContextForTest;

const { persistShutdownState, registerShutdownHooks } = createShutdownStatePersistence({
  getBanditState: () => banditState,
  banditStateFile: BANDIT_STATE_FILE,
  saveBanditState,
  loadGovernanceState,
  saveGovernanceState,
  logger
});

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

async function main(): Promise<void> {
  registerShutdownHooks();
  banditState = await loadBanditState(BANDIT_STATE_FILE);
  logger.info(`Bandit state loaded (${banditState.arms.size} arms)`);
  await policySnapshotManager.start();
  logger.info(`Policy snapshot started (mode=${policySnapshotManager.mode})`);

  const observabilityRuntime = await startObservabilityRuntime(logger);
  observabilityRuntime.setReady(false);

  await initializeServerRuntimeModule({
    logger,
    customToolsDir: CUSTOM_TOOLS_DIR,
    handlersState,
    loadCustomToolsFromDir,
    refreshDisabledToolsCache: (reason?: string) => disabledToolsCache.refresh(reason ?? "manual"),
    startDisabledToolsCacheSync: () => disabledToolsCache.startSync(),
    resetDisabledToolsCache: () => disabledToolsCache.resetCache(),
    autoInitializeHandlers
  });

  let temporalWorker: TemporalWorkflowWorkerHandle | null = null;
  const workflowMode = getWorkflowEngineMode("in-process", process.env);
  if (workflowMode === "temporal" && getTemporalRunWorkerEnabled(false, process.env)) {
    try {
      temporalWorker = await createTemporalWorkflowWorker({
        temporalAddress: getTemporalAddress("localhost:7233", process.env),
        temporalNamespace: getTemporalNamespace("default", process.env),
        taskQueue: getTemporalTaskQueue("sfai-orchestration", process.env),
        activities: createTemporalWorkflowActivities({
          orchestrationQueueStore,
          orchestrationJobRunner
        })
      });
      logger.info("Temporal workflow worker started");
    } catch (error) {
      logger.warn(`Temporal workflow worker startup failed: ${summarizeValue(error, 300)}`);
    }
  }

  observabilityRuntime.setStartupComplete(true);
  observabilityRuntime.setReady(true);

  let metricsAutoUpdateTimer: NodeJS.Timeout | null = null;
  const metricsAutoUpdateEnabled = isEnvFlagEnabled("SF_AI_METRICS_AUTO_UPDATE_ENABLED", process.env, false);
  if (metricsAutoUpdateEnabled) {
    const intervalMinutes = Math.max(1, parseOptionalNumber(process.env.SF_AI_METRICS_AUTO_UPDATE_INTERVAL_MINUTES) ?? 60);
    const intervalMs = intervalMinutes * 60 * 1000;

    const runLeaderGatedMetricsUpdate = async (): Promise<void> => {
      const metricsEnv = getMetricsAutoUpdateEnvConfig();
      await leaderElection.runIfLeader({
        lockKey: 'metrics-auto-update',
        onLeader: async () => {
          const learningOrchestratorEnabled = parseBooleanLike(metricsEnv.learningOrchestratorEnabled, false);
          const eventStore =
            learningOrchestratorEnabled && DATABASE_URL
              ? await PostgresEventStore.open({ databaseUrl: DATABASE_URL })
              : undefined;
          try {
            const result = await runMetricsAutoUpdate({
              reportingHours: parseOptionalNumber(metricsEnv.reportingHours),
              includeDriftDetection: parseBooleanLike(metricsEnv.includeDriftDetection, false),
              driftBaselineHours: parseOptionalNumber(metricsEnv.driftBaselineHours),
              driftRecentHours: parseOptionalNumber(metricsEnv.driftRecentHours),
              minRecentRewardSamples: parseOptionalNumber(metricsEnv.driftMinRewardSamples),
              rewardDriftThreshold: parseOptionalNumber(metricsEnv.driftThreshold),
              adaptiveRewardDriftThreshold: metricsEnv.driftAdaptiveThreshold
                ? parseBooleanLike(metricsEnv.driftAdaptiveThreshold, false)
                : undefined,
              minAdaptiveRewardDriftThreshold: parseOptionalNumber(metricsEnv.driftAdaptiveMinThreshold),
              maxAdaptiveRewardDriftThreshold: parseOptionalNumber(metricsEnv.driftAdaptiveMaxThreshold),
              minReputationSamplesPerWindow: parseOptionalNumber(metricsEnv.driftMinReputationSamples),
              regressionThreshold: parseOptionalNumber(metricsEnv.regressionThreshold),
              driftReportPath: metricsEnv.driftReportPath,
              freezeOnDriftAlert: parseBooleanLike(metricsEnv.driftFreezeEnabled, true),
              freezeDurationHours: parseOptionalNumber(metricsEnv.driftFreezeHours),
              freezeStatePath: metricsEnv.driftFreezeStatePath,
              learningOrchestratorEnabled,
              learningSnapshotPath: metricsEnv.learningSnapshotPath,
              learningModelNames: parseOptionalCsvList(metricsEnv.learningModelNames),
              learningCurrentCanaryVersions: parseCanaryVersionMap(metricsEnv.learningCurrentCanaryMap),
              learningCanaryStatePath: metricsEnv.learningCanaryStatePath,
              learningCanaryTrafficPercent: parseOptionalNumber(metricsEnv.learningCanaryTrafficPercent),
              learningManualApprovalRequired: metricsEnv.learningManualApprovalRequired
                ? parseBooleanLike(metricsEnv.learningManualApprovalRequired, false)
                : undefined,
              learningManualOverride:
                metricsEnv.learningManualOverride === "approve" || metricsEnv.learningManualOverride === "reject"
                  ? metricsEnv.learningManualOverride
                  : undefined,
              learningActorId: metricsEnv.learningActorId,
              learningReportPath: metricsEnv.learningReportPath,
              learningEventStore: eventStore,
              learningQueueProposal: async (input) => proposalQueue.enqueue(input)
            });
            if (result.driftReport?.shouldAlert) {
              logger.warn(
                `[metrics-auto-update] drift alert detected: ${result.driftReport.alerts.join(" | ")}`
              );
            } else {
              logger.info("[metrics-auto-update] leader run completed");
            }
          } finally {
            await eventStore?.close();
          }
        },
        onFollower: async () => {
          logger.debug(
            `metrics auto-update skipped (not leader, instance=${leaderElection.describeInstance()})`
          );
        }
      });
    };

    try {
      await runLeaderGatedMetricsUpdate();
    } catch (error) {
      logger.warn(`metrics auto-update startup run failed: ${summarizeValue(error, 300)}`);
    }

    metricsAutoUpdateTimer = setInterval(() => {
      void runLeaderGatedMetricsUpdate().catch((error) => {
        logger.warn(`metrics auto-update interval run failed: ${summarizeValue(error, 300)}`);
      });
    }, intervalMs);

    logger.info(`metrics auto-update scheduler started (interval=${intervalMinutes}m, leader-gated)`);
  }

  try {
    await startMcpTransport(server, logger);
  } finally {
    await persistShutdownState("main-finally");
    if (typeof proposalQueue.close === "function") {
      await proposalQueue.close();
    }
    await leaderElection.close();
    await policySnapshotManager.close();
    await orchestrationJobRunner.close();
    await orchestrationQueueStore.close();
    if (metricsAutoUpdateTimer) {
      clearInterval(metricsAutoUpdateTimer);
    }
    await sessionStore.close();
    if (temporalWorker) {
      await temporalWorker.close();
    }
    await observabilityRuntime.stop();
  }
}

runWithLifecycle({
  importMetaUrl: import.meta.url,
  argvPath: process.argv[1],
  logger,
  start: main
});

