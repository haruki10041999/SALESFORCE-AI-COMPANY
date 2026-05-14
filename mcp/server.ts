// .env ��S���W���[�����O�ɓǂݍ��� (����p import)�B
// ����: ESM �� import �͐錾���ɕ]������邽�߁A�K���g�b�v�ɔz�u���邱�ƁB
import "./env-loader.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "path";
import { AppError } from "./core/errors/messages.js";
import {
  initializeServerRuntime as initializeServerRuntimeModule,
  registerServerTools,
  startMcpSurfaceEntrypoint,
  runWithLifecycle
} from "./surface/index.js";
import { startTemporalWorkerBootstrap } from "./surface/bootstrap/bootstrap-workflow.js";
import { startMetricsAutoUpdateBootstrap } from "./surface/bootstrap/bootstrap-metrics-auto-update.js";
import { startObservabilityBootstrap } from "./surface/bootstrap/bootstrap-observability.js";
import { runGovernanceCleanupStartupSync } from "./surface/bootstrap/bootstrap-governance-cleanup-sync.js";
import { startPresetsHistoryBootstrap } from "./surface/bootstrap/bootstrap-presets-history.js";
import { startOrchestrationBootstrap } from "./surface/bootstrap/bootstrap-orchestration.js";
import { startLeaderElectionBootstrap } from "./surface/bootstrap/bootstrap-leader-election.js";
import { startOutboxDispatcherBootstrap } from "./surface/bootstrap/bootstrap-outbox-dispatcher.js";
import { startVectorLifecycleBootstrap } from "./surface/bootstrap/bootstrap-vector-lifecycle.js";
import { createSessionCompletedMemoryHook } from "./surface/bootstrap/bootstrap-memory.js";
import { startGovernanceBootstrap } from "./surface/bootstrap/bootstrap-governance.js";
import { createToolCatalog, type ToolCatalogEntry } from "./surface/tool-catalog.js";
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
import { CostLedgerManager } from "./core/governance/cost-ledger-manager.js";
import { createGovernanceStateManager } from "./core/governance/governance-state-manager.js";
import { resolveStateBackend } from "./core/persistence/state-store.js";
import {
  type GovernanceState
} from "./core/governance/governance-state.js";
import { PostgresEventStore } from "./core/persistence/postgres-event-store.js";
import {
  createRuntimeTemporalWorkflowWorker,
  type TemporalWorkflowWorkerHandle
} from "./infrastructure/workflow/temporal-workflow-worker.js";
import { runMetricsAutoUpdate } from "./core/learning/metrics-auto-update.js";
import { createPromptRenderer } from "./core/context/prompt-rendering.js";
import { isEnvFlagEnabled, parseBooleanLike } from "./core/config/env-flags.js";
import { evaluatePseudoHooks as evaluatePseudoHooksCore } from "./core/orchestration/pseudo-hooks.js";
import { generateSessionId } from "./core/orchestration/chat-tool-runner.js";
import { clearOrchestrationSessionsForTest } from "./core/orchestration/session-registry.js";
import { chatInputSchema, triggerRuleSchema } from "./core/orchestration/schemas.js";
import type { SystemEventType } from "./core/event/event-dispatcher.js";
import { createLogger } from "./core/logging/logger.js";
import {
  getMetricsAutoUpdateEnvConfig,
  getLowRelevanceScoreThreshold,
  getReplayDeterminismMode,
  getTemporalRunWorkerEnabled,
  getWorkflowEngineMode
} from "./core/config/runtime-config.js";
import { resolveEnvMode } from "./env-schema.js";
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
const STATE_BACKEND = resolveStateBackend(process.env.SF_AI_STATE_BACKEND);
const DATABASE_URL = process.env.DATABASE_URL;
const presetsHistoryBootstrap = await startPresetsHistoryBootstrap({
  outputsDir: OUTPUTS_DIR,
  stateDbPath: STATE_DB_PATH,
  stateBackend: STATE_BACKEND,
  databaseUrl: DATABASE_URL,
  agentLog,
  env: process.env
});
const {
  presetsDir: PRESETS_DIR,
  ensureDir,
  createPreset,
  listPresetsData,
  getPreset,
  saveChatHistory,
  saveSessionHistory,
  loadChatHistories,
  restoreChatHistory,
  sessionStore
} = presetsHistoryBootstrap;
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
const toolCatalog = createToolCatalog();
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

export function listRegisteredToolCatalogForTest(): ToolCatalogEntry[] {
  return toolCatalog.list();
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
const costLedger = costLedgerManager
  ? {
      async record(
        ctxOrInput: {
          tenantId: string;
          actorId: string;
          traceId: string;
          sessionId?: string;
          reasonCode?: string;
        } | {
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
        },
        maybeInput?: {
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
        }
      ): Promise<void> {
        const input = maybeInput ?? (ctxOrInput as {
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
        });
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

let applyEventAutomationImpl:
  | ((event: SystemEventName, payload: Record<string, unknown>) => Promise<void>)
  | null = null;

const governanceBootstrap = startGovernanceBootstrap({
  logger,
  governanceStoragePath: GOVERNANCE_STORAGE_PATH,
  outputsDir: OUTPUTS_DIR,
  serverRoot: ROOT,
  stateBackend: STATE_BACKEND,
  databaseUrl: DATABASE_URL,
  toPosixPath,
  loadGovernanceState,
  saveGovernanceState,
  normalizeDisabledEntries,
  normalizeProtectedTools,
  buildDefaultGovernanceState,
  emitSystemEvent: emitSystemEventFromTools,
  summarizeValue,
  registerToolFailure,
  getBanditState: () => banditState,
  banditStateFile: BANDIT_STATE_FILE,
  registerTool: (name, config, handler) => {
    server.registerTool(
      name,
      config as Parameters<typeof server.registerTool>[1],
      handler as Parameters<typeof server.registerTool>[2]
    );
  },
  onToolDefined: (definition) => {
    registeredToolDefinitions.set(definition.name, definition);
    toolCatalog.upsert(definition);
  },
  costLedger
});

const {
  govTool,
  disabledToolsCache,
  filterDisabledSkills,
  isPresetDisabled,
  applyEventAutomation: applyGovernanceEventAutomation
} = governanceBootstrap;
applyEventAutomationImpl = applyGovernanceEventAutomation;

const orchestrationBootstrap = await startOrchestrationBootstrap({
  rootDir: ROOT,
  stateBackend: STATE_BACKEND,
  databaseUrl: DATABASE_URL,
  outputsDir: OUTPUTS_DIR,
  banditStateFile: BANDIT_STATE_FILE,
  listSkills: () => listMdFiles("skills"),
  filterDisabledSkills,
  emitSystemEvent: emitSystemEventFromTools,
  buildChatPrompt
});

const {
  runChatTool,
  orchestrationQueueStore,
  orchestrationJobRunner,
  workflowEngine,
  policySnapshotManager
} = orchestrationBootstrap;

const proposalQueue: ProposalQueueStore = await createProposalQueueStore({
  backend: PROPOSAL_QUEUE_BACKEND,
  outputsDir: OUTPUTS_DIR,
  databaseUrl: DATABASE_URL
});

const leaderElection = startLeaderElectionBootstrap({
  databaseUrl: DATABASE_URL,
  env: process.env
});

await runGovernanceCleanupStartupSync({
  proposalQueueBackend: PROPOSAL_QUEUE_BACKEND,
  proposalQueue,
  leaderElection,
  rootDir: ROOT,
  logger,
  summarizeError: (error) => summarizeValue(error, 300)
});

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

async function applyEventAutomation(event: SystemEventName, payload: Record<string, unknown>): Promise<void> {
  if (applyEventAutomationImpl) {
    await applyEventAutomationImpl(event, payload);
  }
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
  onSessionCompleted: createSessionCompletedMemoryHook({ ingestKnowledgeSummary })
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

  const observabilityBootstrap = await startObservabilityBootstrap(logger);
  const observabilityRuntime = observabilityBootstrap.runtime;

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
  const envMode = resolveEnvMode(process.env);
  const workflowMode = getWorkflowEngineMode(envMode === "prod" ? "temporal" : "in-process", process.env);
  if (envMode === "prod" && workflowMode !== "temporal") {
    throw new Error("SF_AI_ENV_MODE=prod requires SF_AI_WORKFLOW_ENGINE=temporal");
  }
  temporalWorker = await startTemporalWorkerBootstrap({
    workflowMode,
    runWorkerEnabled: getTemporalRunWorkerEnabled(false, process.env),
    logger,
    createWorker: async () =>
      createRuntimeTemporalWorkflowWorker({
        orchestrationQueueStore,
        orchestrationJobRunner,
        env: process.env
      }),
    summarizeError: (error) => summarizeValue(error, 300)
  });

  observabilityBootstrap.markStartupReady();

  let metricsAutoUpdateHandle: { stop(): void } | null = null;
  let outboxDispatcherHandle: { stop(): Promise<void> } | null = null;
  let vectorLifecycleHandle: { stop(): Promise<void> } | null = null;
  const metricsAutoUpdateEnabled = isEnvFlagEnabled("SF_AI_METRICS_AUTO_UPDATE_ENABLED", process.env, false);
  if (metricsAutoUpdateEnabled) {
    const intervalMinutes = Math.max(1, parseOptionalNumber(process.env.SF_AI_METRICS_AUTO_UPDATE_INTERVAL_MINUTES) ?? 60);

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

    metricsAutoUpdateHandle = await startMetricsAutoUpdateBootstrap({
      enabled: metricsAutoUpdateEnabled,
      intervalMinutes,
      logger,
      runLeaderGatedUpdate: runLeaderGatedMetricsUpdate,
      summarizeError: (error) => summarizeValue(error, 300)
    });
  }

  const replayDeterminismMode = getReplayDeterminismMode("observe", process.env);
  const outboxDispatchEnabledByEnv = isEnvFlagEnabled("SF_AI_OUTBOX_DISPATCH_ENABLED", process.env, true);
  const outboxDispatchEnabled = outboxDispatchEnabledByEnv && replayDeterminismMode !== "strict";
  if (outboxDispatchEnabledByEnv && replayDeterminismMode === "strict") {
    logger.info("[outbox-dispatch] disabled because SF_AI_REPLAY_MODE=strict");
  }
  const outboxDispatchIntervalSeconds = Math.max(
    5,
    parseOptionalNumber(process.env.SF_AI_OUTBOX_DISPATCH_INTERVAL_SECONDS) ?? 30
  );
  const outboxDispatchLimit = Math.max(
    1,
    parseOptionalNumber(process.env.SF_AI_OUTBOX_DISPATCH_LIMIT) ?? 200
  );
  const outboxQueuePrefix = process.env.SF_AI_OUTBOX_QUEUE_PREFIX?.trim() || "outbox";
  outboxDispatcherHandle = await startOutboxDispatcherBootstrap({
    enabled: outboxDispatchEnabled,
    databaseUrl: DATABASE_URL,
    queuePrefix: outboxQueuePrefix,
    dispatchLimit: outboxDispatchLimit,
    intervalSeconds: outboxDispatchIntervalSeconds,
    logger,
    leaderElection
  });

  const vectorLifecycleEnabled = isEnvFlagEnabled("SF_AI_VECTOR_LIFECYCLE_ENABLED", process.env, false);
  const vectorLifecycleCron = process.env.SF_AI_VECTOR_LIFECYCLE_CRON?.trim() || "0 3 * * *";
  const vectorLifecycleHotToWarmDays = Math.max(
    1,
    parseOptionalNumber(process.env.SF_AI_VECTOR_HOT_TO_WARM_DAYS) ?? 7
  );
  const vectorLifecycleWarmToColdDays = Math.max(
    vectorLifecycleHotToWarmDays + 1,
    parseOptionalNumber(process.env.SF_AI_VECTOR_WARM_TO_COLD_DAYS) ?? 90
  );
  const vectorLifecycleRunOnStartup = isEnvFlagEnabled("SF_AI_VECTOR_LIFECYCLE_RUN_ON_STARTUP", process.env, false);
  const vectorLifecycleStartupLimit = Math.max(
    1,
    parseOptionalNumber(process.env.SF_AI_VECTOR_LIFECYCLE_STARTUP_LIMIT) ?? 2000
  );
  vectorLifecycleHandle = await startVectorLifecycleBootstrap({
    enabled: vectorLifecycleEnabled,
    databaseUrl: DATABASE_URL,
    cronPattern: vectorLifecycleCron,
    runOnStartup: vectorLifecycleRunOnStartup,
    startupLimit: vectorLifecycleStartupLimit,
    hotToWarmDays: vectorLifecycleHotToWarmDays,
    warmToColdDays: vectorLifecycleWarmToColdDays,
    logger
  });

  try {
    await startMcpSurfaceEntrypoint(server, logger);
  } finally {
    await persistShutdownState("main-finally");
    if (typeof proposalQueue.close === "function") {
      await proposalQueue.close();
    }
    await leaderElection.close();
    await policySnapshotManager.close();
    await orchestrationJobRunner.close();
    await orchestrationQueueStore.close();
    metricsAutoUpdateHandle?.stop();
    await vectorLifecycleHandle?.stop();
    await outboxDispatcherHandle?.stop();
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

