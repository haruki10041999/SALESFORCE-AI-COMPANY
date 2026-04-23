import type { registerAllTools } from "./register-all-tools.js";
import type { GovTool } from "@mcp/tool-types.js";
import type { z } from "zod";
import type { GovernanceState } from "../governance/governance-state.js";
import type { ResourceOperation as GovernanceResourceOperation } from "../governance/governance-manager.js";
import type { SystemEventName, SystemEventRecord } from "../event/system-event-manager.js";
import type { SystemEventType } from "../event/event-dispatcher.js";
import type {
  AgentMessage,
  ChatSession,
  ChatPreset,
  StoredPreset,
  CustomToolDefinition,
  ResourceOperation,
  OrchestrationSession,
  HandlersDashboardState
} from "../types/index.js";
import type { HandlersState } from "../../handlers/auto-init.js";
import type { HandlersStatistics } from "../../handlers/statistics-manager.js";
import type { CustomToolDefinition as RegistryCustomToolDefinition } from "../resource/custom-tool-registry.js";

type RegisterAllToolsDeps = Parameters<typeof registerAllTools>[0];

interface BuildRegisterAllToolsDepsOptions {
  govTool: GovTool;
  chatInputSchema: Record<string, unknown>;
  triggerRuleSchema: z.ZodTypeAny;
  runChatTool: RegisterAllToolsDeps["runChatTool"];
  generateSessionId: () => string;
  filterDisabledSkills: (skills: string[]) => Promise<{ enabled: string[]; disabled: string[] }>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  buildChatPrompt: RegisterAllToolsDeps["buildChatPrompt"];
  evaluatePseudoHooks: RegisterAllToolsDeps["evaluatePseudoHooks"];
  orchestrationSessions: Map<string, OrchestrationSession>;
  saveOrchestrationSession: RegisterAllToolsDeps["saveOrchestrationSession"];
  saveSessionHistory: RegisterAllToolsDeps["saveSessionHistory"];
  restoreOrchestrationSession: RegisterAllToolsDeps["restoreOrchestrationSession"];
  root: string;
  agentLog: AgentMessage[];
  loadSystemEvents: (limit?: number, event?: string) => Promise<SystemEventRecord[]>;
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  buildDefaultGovernanceState: () => GovernanceState;
  normalizeProtectedTools: (names: string[]) => string[];
  saveChatHistory: (topic: string) => Promise<string>;
  loadChatHistories: () => Promise<ChatSession[]>;
  restoreChatHistory: (id: string) => Promise<ChatSession | null>;
  listMdFiles: (dir: string) => { name: string; summary: string }[];
  getMdFile: (dir: string, name: string) => string;
  listPresetsData: () => Promise<StoredPreset[]>;
  scoreByQuery: (query: string, ...targets: string[]) => number;
  lowRelevanceScoreThreshold: number;
  registeredToolMetadata: Map<string, { title?: string; description?: string; tags?: string[] }>;
  createPreset: (preset: StoredPreset) => Promise<void>;
  getPreset: (name: string) => Promise<StoredPreset | null>;
  isPresetDisabled: (name: string) => Promise<boolean>;
  getSystemEventLogStatus: RegisterAllToolsDeps["getSystemEventLogStatus"];
  generateHandlersDashboard: (state: HandlersState) => unknown;
  handlersState: HandlersState;
  exportStatisticsAsCsv: (stats: HandlersStatistics) => string;
  exportStatisticsAsJson: (stats: HandlersStatistics) => string;
  ensureDir: (path: string) => Promise<void>;
  addMemory: (text: string) => void;
  searchMemory: (query: string) => string[];
  listMemory: () => string[];
  clearMemory: () => void;
  findMdFilesRecursive: (dir: string) => string[];
  toPosixPath: (pathValue: string) => string;
  addRecord: (record: { id: string; text: string; tags: string[] }) => void;
  searchByKeyword: (query: string) => Array<{ id: string; text: string; tags?: string[] }>;
  buildPrompt: (agent: { name: string; content: string }, task: string) => string;
  evaluatePromptMetrics: RegisterAllToolsDeps["evaluatePromptMetrics"];
  presetsDir: string;
  toolProposalsDir: string;
  customToolsDir: string;
  governanceFile: string;
  loadRecentOperations: () => Promise<GovernanceResourceOperation[]>;
  checkDailyLimitExceeded: (ops: ResourceOperation[], action: "create" | "delete", limit: number) => boolean;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
  validateAndCreateSkillWithQuality: RegisterAllToolsDeps["validateAndCreateSkillWithQuality"];
  validateAndCreatePresetWithQuality: RegisterAllToolsDeps["validateAndCreatePresetWithQuality"];
  validateAndCreateToolWithQuality: RegisterAllToolsDeps["validateAndCreateToolWithQuality"];
  registerCustomTool: (tool: RegistryCustomToolDefinition) => void;
  unregisterCustomTool: (name: string) => void;
  refreshDisabledToolsCache: () => Promise<void>;
  appendOperationLog: (operation: ResourceOperation) => Promise<void>;
  emitEvent: (event: { type: SystemEventType; timestamp: string; payload: Record<string, unknown> }) => Promise<void>;
  resourceScore: (usage: number, bugSignals: number) => number;
}

export function buildRegisterAllToolsDeps(options: BuildRegisterAllToolsDepsOptions): RegisterAllToolsDeps {
  async function createPresetCompat(preset: ChatPreset): Promise<void> {
    await options.createPreset({
      ...preset,
      skills: preset.skills ?? []
    });
  }

  function registerCustomToolCompat(tool: CustomToolDefinition): void {
    options.registerCustomTool({
      ...tool,
      skills: tool.skills ?? []
    });
  }

  async function loadSystemEventsCompat(limit?: number, event?: string): Promise<SystemEventRecord[]> {
    return options.loadSystemEvents(limit, event);
  }

  function generateHandlersDashboardCompat(state: {
    createdTracker: unknown;
    deletedTracker: unknown;
    errorTracker: unknown;
    qualityTracker: unknown;
  }): HandlersDashboardState {
    return options.generateHandlersDashboard(state as HandlersState) as HandlersDashboardState;
  }

  function exportStatisticsAsCsvCompat(stats: {
    created: unknown;
    deleted: unknown;
    errors: unknown;
    qualityFailures: unknown;
    lastUpdated: string;
  }): string {
    return options.exportStatisticsAsCsv(stats as HandlersStatistics);
  }

  function exportStatisticsAsJsonCompat(stats: {
    created: unknown;
    deleted: unknown;
    errors: unknown;
    qualityFailures: unknown;
    lastUpdated: string;
  }): string {
    return options.exportStatisticsAsJson(stats as HandlersStatistics);
  }

  async function loadRecentOperationsCompat(): Promise<ResourceOperation[]> {
    const operations = await options.loadRecentOperations();
    return operations.filter(
      (operation): operation is ResourceOperation => operation.type === "create" || operation.type === "delete"
    );
  }

  async function emitCoreEventCompat(event: {
    type: string;
    timestamp: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    if (
      event.type === "resource_gap_detected" ||
      event.type === "resource_created" ||
      event.type === "resource_deleted" ||
      event.type === "error_aggregate_detected" ||
      event.type === "governance_threshold_exceeded" ||
      event.type === "quality_check_failed"
    ) {
      await options.emitEvent(event as {
        type: SystemEventType;
        timestamp: string;
        payload: Record<string, unknown>;
      });
    }
  }

  return {
    govTool: options.govTool,
    chatInputSchema: options.chatInputSchema,
    triggerRuleSchema: options.triggerRuleSchema,
    runChatTool: options.runChatTool,
    generateSessionId: options.generateSessionId,
    filterDisabledSkills: options.filterDisabledSkills,
    emitSystemEvent: options.emitSystemEvent,
    buildChatPrompt: options.buildChatPrompt,
    evaluatePseudoHooks: options.evaluatePseudoHooks,
    orchestrationSessions: options.orchestrationSessions,
    saveOrchestrationSession: options.saveOrchestrationSession,
    saveSessionHistory: options.saveSessionHistory,
    restoreOrchestrationSession: options.restoreOrchestrationSession,
    root: options.root,
    agentLog: options.agentLog,
    loadSystemEvents: (limit?: number, event?: SystemEventName) => loadSystemEventsCompat(limit, event),
    loadGovernanceState: options.loadGovernanceState,
    saveGovernanceState: options.saveGovernanceState,
    buildDefaultGovernanceState: options.buildDefaultGovernanceState,
    normalizeProtectedTools: options.normalizeProtectedTools,
    saveChatHistory: options.saveChatHistory,
    loadChatHistories: options.loadChatHistories,
    restoreChatHistory: options.restoreChatHistory,
    listMdFiles: options.listMdFiles,
    getMdFile: options.getMdFile,
    listPresetsData: options.listPresetsData,
    scoreByQuery: options.scoreByQuery,
    lowRelevanceScoreThreshold: options.lowRelevanceScoreThreshold,
    registeredToolMetadata: options.registeredToolMetadata,
    createPreset: createPresetCompat,
    getPreset: options.getPreset,
    isPresetDisabled: options.isPresetDisabled,
    getSystemEventLogStatus: options.getSystemEventLogStatus,
    generateHandlersDashboard: generateHandlersDashboardCompat,
    handlersState: options.handlersState,
    exportStatisticsAsCsv: exportStatisticsAsCsvCompat,
    exportStatisticsAsJson: exportStatisticsAsJsonCompat,
    ensureDir: options.ensureDir,
    addMemory: options.addMemory,
    searchMemory: options.searchMemory,
    listMemory: options.listMemory,
    clearMemory: options.clearMemory,
    findMdFilesRecursive: options.findMdFilesRecursive,
    toPosixPath: options.toPosixPath,
    addRecord: options.addRecord,
    searchByKeyword: options.searchByKeyword,
    buildPrompt: options.buildPrompt,
    evaluatePromptMetrics: options.evaluatePromptMetrics,
    presetsDir: options.presetsDir,
    toolProposalsDir: options.toolProposalsDir,
    customToolsDir: options.customToolsDir,
    governanceFile: options.governanceFile,
    loadRecentOperations: loadRecentOperationsCompat,
    checkDailyLimitExceeded: options.checkDailyLimitExceeded,
    listSkillsCatalog: options.listSkillsCatalog,
    listPresetsCatalog: options.listPresetsCatalog,
    listToolsCatalog: options.listToolsCatalog,
    validateAndCreateSkillWithQuality: options.validateAndCreateSkillWithQuality,
    validateAndCreatePresetWithQuality: options.validateAndCreatePresetWithQuality,
    validateAndCreateToolWithQuality: options.validateAndCreateToolWithQuality,
    registerCustomTool: registerCustomToolCompat,
    unregisterCustomTool: options.unregisterCustomTool,
    refreshDisabledToolsCache: options.refreshDisabledToolsCache,
    appendOperationLog: options.appendOperationLog,
    emitEvent: emitCoreEventCompat,
    resourceScore: options.resourceScore
  };
}