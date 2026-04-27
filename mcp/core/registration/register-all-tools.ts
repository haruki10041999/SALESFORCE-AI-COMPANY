import { promises as fsPromises } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { registerCoreAnalysisTools } from "../../handlers/register-core-analysis-tools.js";
import { registerBranchReviewTools } from "../../handlers/register-branch-review-tools.js";
import { registerResourceCatalogTools } from "../../handlers/register-resource-catalog-tools.js";
import { registerChatOrchestrationTools } from "../../handlers/register-chat-orchestration-tools.js";
import {
  registerLoggingTools,
  registerHistoryTools,
  registerResourceGovernanceTools,
  registerResourceActionTools,
  registerSmartChatTools,
  registerAnalyticsTools,
  registerExportTools,
  registerMemoryTools,
  registerContextTools
} from "../../handlers/index.js";
import { registerResourceSearchTools } from "../../handlers/register-resource-search-tools.js";
import { registerPresetTools } from "../../handlers/register-preset-tools.js";
import { registerVectorPromptTools } from "../../handlers/register-vector-prompt-tools.js";
import { registerBatchTools } from "../../handlers/register-batch-tools.js";
import { registerOrgCatalogTools } from "../../handlers/register-org-catalog-tools.js";
import type { GovTool } from "@mcp/tool-types.js";
import type { GovernanceState } from "../governance/governance-state.js";
import type { SystemEventName, SystemEventRecord } from "../event/system-event-manager.js";
import type {
  AgentMessage,
  ChatSession,
  ChatPreset,
  StoredPreset,
  CustomToolDefinition,
  ResourceOperation,
  TriggerRule,
  OrchestrationSession,
  HandlersDashboardState,
  ExportStatistics
} from "../types/index.js";

interface RegisterAllToolsDeps {
  govTool: GovTool;
  chatInputSchema: Record<string, unknown>;
  triggerRuleSchema: z.ZodTypeAny;
  runChatTool: (input: {
    topic: string;
    filePaths?: string[];
    agents?: string[];
    persona?: string;
    skills?: string[];
    turns?: number;
    maxContextChars?: number;
    appendInstruction?: string;
  }) => Promise<{ content: Array<{ type: string; text: string }> }>;
  generateSessionId: () => string;
  filterDisabledSkills: (skills: string[]) => Promise<{ enabled: string[]; disabled: string[] }>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  buildChatPrompt: (
    topic: string,
    agentNames: string[],
    personaName?: string,
    skillNames?: string[],
    filePaths?: string[],
    turns?: number,
    maxContextChars?: number,
    appendInstruction?: string,
    includeProjectContext?: boolean
  ) => Promise<string>;
  evaluatePseudoHooks: (
    lastAgent: string,
    lastMessage: string,
    triggerRules: TriggerRule[],
    firedRules: string[]
  ) => { nextAgents: string[]; fired: string[]; reasons: string[] };
  orchestrationSessions: Map<string, OrchestrationSession>;
  saveOrchestrationSession: (sessionId: string) => Promise<{ sessionId: string; filePath: string; historyCount: number } | null>;
  saveSessionHistory: (topic: string, entries: AgentMessage[]) => Promise<string>;
  restoreOrchestrationSession: (sessionId: string) => Promise<OrchestrationSession | null>;
  root: string;
  agentLog: AgentMessage[];
  loadSystemEvents: (limit?: number, event?: SystemEventName) => Promise<SystemEventRecord[]>;
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
  createPreset: (preset: ChatPreset) => Promise<void>;
  getPreset: (name: string) => Promise<StoredPreset | null>;
  isPresetDisabled: (name: string) => Promise<boolean>;
  getSystemEventLogStatus: () => Promise<{
    eventDir: string;
    activeLogPath: string;
    activeLogExists: boolean;
    activeLogSizeBytes: number;
    archiveCount: number;
    archiveTotalSizeBytes: number;
    archives: Array<{ file: string; sizeBytes: number; modifiedAt: string }>;
  }>;
  generateHandlersDashboard: (state: HandlersDashboardState) => HandlersDashboardState;
  handlersState: HandlersDashboardState;
  exportStatisticsAsCsv: (stats: ExportStatistics) => string;
  exportStatisticsAsJson: (stats: ExportStatistics) => string;
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
  evaluatePromptMetrics: (prompt: string, skills?: string[], triggerKeywords?: string[]) => {
    lengthChars: number;
    lineCount: number;
    estimatedTokens: number;
    containsProjectContext: boolean;
    containsAgentsSection: boolean;
    containsSkillsSection: boolean;
    containsTaskSection: boolean;
    matchedSkillCount: number;
    totalSkillCount: number;
    matchedTriggerCount: number;
    totalTriggerCount: number;
    skillCoverageRate: number;
    triggerMatchRate: number;
  };
  presetsDir: string;
  toolProposalsDir: string;
  customToolsDir: string;
  governanceFile: string;
  loadRecentOperations: () => Promise<ResourceOperation[]>;
  checkDailyLimitExceeded: (ops: ResourceOperation[], action: "create" | "delete", limit: number) => boolean;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
  validateAndCreateSkillWithQuality: (
    name: string,
    content: string,
    state: GovernanceState
  ) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  validateAndCreatePresetWithQuality: (
    name: string,
    preset: { description: string; agents: string[]; topic: string },
    state: GovernanceState
  ) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  validateAndCreateToolWithQuality: (
    name: string,
    description: string,
    state: GovernanceState
  ) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  registerCustomTool: (tool: CustomToolDefinition) => void;
  unregisterCustomTool: (name: string) => void;
  refreshDisabledToolsCache: () => Promise<void>;
  appendOperationLog: (operation: ResourceOperation) => Promise<void>;
  emitEvent: (event: { type: string; timestamp: string; payload: Record<string, unknown> }) => Promise<void>;
  resourceScore: (usage: number, bugSignals: number) => number;
}

export function registerAllTools(deps: RegisterAllToolsDeps): void {
  const {
    govTool,
    chatInputSchema,
    triggerRuleSchema,
    runChatTool,
    generateSessionId,
    filterDisabledSkills,
    emitSystemEvent,
    buildChatPrompt,
    evaluatePseudoHooks,
    orchestrationSessions,
    saveOrchestrationSession,
    saveSessionHistory,
    restoreOrchestrationSession,
    root,
    agentLog,
    loadSystemEvents,
    loadGovernanceState,
    saveGovernanceState,
    buildDefaultGovernanceState,
    normalizeProtectedTools,
    saveChatHistory,
    loadChatHistories,
    restoreChatHistory,
    listMdFiles,
    getMdFile,
    listPresetsData,
    scoreByQuery,
    lowRelevanceScoreThreshold,
    registeredToolMetadata,
    createPreset,
    getPreset,
    isPresetDisabled,
    getSystemEventLogStatus,
    generateHandlersDashboard,
    handlersState,
    exportStatisticsAsCsv,
    exportStatisticsAsJson,
    ensureDir,
    addMemory,
    searchMemory,
    listMemory,
    clearMemory,
    findMdFilesRecursive,
    toPosixPath,
    addRecord,
    searchByKeyword,
    buildPrompt,
    evaluatePromptMetrics,
    presetsDir,
    toolProposalsDir,
    customToolsDir,
    governanceFile,
    loadRecentOperations,
    checkDailyLimitExceeded,
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    validateAndCreateSkillWithQuality,
    validateAndCreatePresetWithQuality,
    validateAndCreateToolWithQuality,
    registerCustomTool,
    unregisterCustomTool,
    refreshDisabledToolsCache,
    appendOperationLog,
    emitEvent,
    resourceScore
  } = deps;

  registerCoreAnalysisTools(govTool, {
    listSkillsWithSummary: () => listMdFiles("skills")
  });
  registerBranchReviewTools(govTool);
  registerOrgCatalogTools({ govTool, outputsDir: join(root, "outputs") });
  registerResourceCatalogTools({
    govTool,
    listMdFiles,
    getMdFile,
    rootDir: root,
    presetsDir
  });

  registerChatOrchestrationTools({
    govTool,
    chatInputSchema,
    triggerRuleSchema,
    runChatTool,
    generateSessionId,
    filterDisabledSkills,
    emitSystemEvent,
    buildChatPrompt,
    evaluatePseudoHooks,
    orchestrationSessions,
    saveOrchestrationSession,
    saveSessionHistory,
    restoreOrchestrationSession,
    sessionsDir: join(root, "outputs", "sessions"),
    readDir: (path: string) => fsPromises.readdir(path),
    readFile: (path: string, encoding: BufferEncoding) => fsPromises.readFile(path, encoding)
  });

  registerLoggingTools({
    govTool,
    agentLog,
    loadSystemEvents,
    loadGovernanceState,
    saveGovernanceState,
    buildDefaultGovernanceState,
    normalizeProtectedTools,
    saveChatHistory,
    emitSystemEvent
  });

  registerHistoryTools({
    govTool,
    agentLog,
    saveChatHistory,
    loadChatHistories,
    restoreChatHistory,
    emitSystemEvent
  });

  registerResourceSearchTools({
    govTool,
    loadGovernanceState,
    listMdFiles,
    listPresetsData,
    scoreByQuery,
    emitSystemEvent,
    lowRelevanceScoreThreshold,
    registeredToolMetadata
  });

  registerPresetTools({
    govTool,
    createPreset,
    listPresetsData,
    getPreset,
    isPresetDisabled,
    filterDisabledSkills,
    buildChatPrompt,
    emitSystemEvent
  });

  registerSmartChatTools({
    govTool,
    root,
    filterDisabledSkills,
    buildChatPrompt
  });

  registerAnalyticsTools({
    govTool,
    agentLog,
    loadChatHistories,
    loadSystemEvents: (limit?: number, event?: string) => loadSystemEvents(limit, event as SystemEventName | undefined),
    getSystemEventLogStatus,
    loadGovernanceState,
    generateHandlersDashboard,
    handlersState,
    exportStatisticsAsCsv,
    exportStatisticsAsJson,
    ensureDir,
    runChatTool,
    evaluatePromptMetrics,
    outputsDir: join(root, "outputs")
  });

  registerExportTools({
    govTool,
    agentLog,
    loadChatHistories,
    ensureDir
  });

  registerMemoryTools({
    govTool,
    addMemory,
    searchMemory,
    listMemory,
    clearMemory
  });

  registerContextTools({
    govTool,
    root,
    findMdFilesRecursive,
    toPosixPath
  });

  registerVectorPromptTools({
    govTool,
    addRecord,
    searchByKeyword,
    buildPrompt,
    evaluatePromptMetrics
  });

  registerBatchTools({
    govTool,
    buildChatPrompt
  });

  registerResourceGovernanceTools({
    govTool,
    loadGovernanceState,
    saveGovernanceState,
    getCatalogCounts: async (state: GovernanceState) => ({
      skills: (await listSkillsCatalog()).length,
      tools: listToolsCatalog(state).length,
      presets: (await listPresetsCatalog()).length
    }),
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    resourceScore,
    emitSystemEvent
  });

  registerResourceActionTools({
    govTool,
    root,
    presetsDir,
    toolProposalsDir,
    customToolsDir,
    governanceFile,
    loadGovernanceState,
    saveGovernanceState,
    ensureDir,
    loadRecentOperations,
    checkDailyLimitExceeded,
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    validateAndCreateSkillWithQuality,
    validateAndCreatePresetWithQuality,
    validateAndCreateToolWithQuality,
    createPreset,
    registerCustomTool,
    unregisterCustomTool,
    refreshDisabledToolsCache,
    appendOperationLog,
    emitEvent,
    toPosixPath,
    loadSystemEvents: (limit?: number, event?: string) => loadSystemEvents(limit, event as SystemEventName | undefined),
    handlersStatistics: {
      created: handlersState.createdTracker,
      deleted: handlersState.deletedTracker,
      errors: handlersState.errorTracker,
      qualityFailures: handlersState.qualityTracker,
      lastUpdated: new Date().toISOString()
    }
  });
}
