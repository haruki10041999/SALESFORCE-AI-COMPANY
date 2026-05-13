import type { registerAllTools } from "./register-all-tools.js";
import type { BuildRegisterAllToolsDepsOptions } from "./register-all-tools-deps-options.js";

type RegisterAllToolsDeps = Parameters<typeof registerAllTools>[0];

type CoreAndSessionDeps = Pick<
  RegisterAllToolsDeps,
  | "govTool"
  | "chatInputSchema"
  | "triggerRuleSchema"
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
  | "root"
  | "agentLog"
  | "loadSystemEvents"
> &
  Partial<Pick<RegisterAllToolsDeps, "onSessionCompleted">>;

type GovernanceDeps = Pick<
  RegisterAllToolsDeps,
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

type PresetAndPromptDeps = Pick<
  RegisterAllToolsDeps,
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

type MemoryAndSearchDeps = Pick<
  RegisterAllToolsDeps,
  | "ensureDir"
  | "addMemory"
  | "searchMemory"
  | "listMemory"
  | "clearMemory"
  | "recordFailureMemory"
  | "searchFailureMemory"
  | "listFailureMemory"
  | "findMdFilesRecursive"
  | "toPosixPath"
  | "addRecord"
  | "searchByKeyword"
> &
  Partial<Pick<RegisterAllToolsDeps, "searchByKeywordAsync">>;

type CatalogAndCustomToolDeps = Pick<
  RegisterAllToolsDeps,
  | "presetsDir"
  | "toolProposalsDir"
  | "customToolsDir"
  | "governanceFile"
  | "listSkillsCatalog"
  | "listPresetsCatalog"
  | "listToolsCatalog"
  | "validateAndCreateSkillWithQuality"
  | "validateAndCreatePresetWithQuality"
  | "validateAndCreateToolWithQuality"
  | "registerCustomTool"
  | "unregisterCustomTool"
  | "refreshDisabledToolsCache"
>;

function buildCoreAndSessionDeps(
  options: BuildRegisterAllToolsDepsOptions
): CoreAndSessionDeps {
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
    sessionStore: options.sessionStore,
    orchestrationQueueStore: options.orchestrationQueueStore,
    orchestrationJobRunner: options.orchestrationJobRunner,
    workflowEngine: options.workflowEngine,
    policySnapshotManager: options.policySnapshotManager,
    saveSessionHistory: options.saveSessionHistory,
    ...(options.onSessionCompleted ? { onSessionCompleted: options.onSessionCompleted } : {}),
    root: options.root,
    agentLog: options.agentLog,
    loadSystemEvents: options.loadSystemEvents
  };
}

function buildGovernanceDeps(
  options: BuildRegisterAllToolsDepsOptions
): GovernanceDeps {
  return {
    loadGovernanceState: options.loadGovernanceState,
    saveGovernanceState: options.saveGovernanceState,
    buildDefaultGovernanceState: options.buildDefaultGovernanceState,
    normalizeProtectedTools: options.normalizeProtectedTools,
    getSystemEventLogStatus: options.getSystemEventLogStatus,
    generateHandlersDashboard: options.generateHandlersDashboard,
    handlersState: options.handlersState,
    exportStatisticsAsCsv: options.exportStatisticsAsCsv,
    exportStatisticsAsJson: options.exportStatisticsAsJson,
    loadRecentOperations: options.loadRecentOperations,
    checkDailyLimitExceeded: options.checkDailyLimitExceeded,
    appendOperationLog: options.appendOperationLog,
    emitEvent: options.emitEvent,
    resourceScore: options.resourceScore,
    proposalQueue: options.proposalQueue
  };
}

function buildPresetAndPromptDeps(
  options: BuildRegisterAllToolsDepsOptions
): PresetAndPromptDeps {
  return {
    saveChatHistory: options.saveChatHistory,
    loadChatHistories: options.loadChatHistories,
    restoreChatHistory: options.restoreChatHistory,
    listMdFiles: options.listMdFiles,
    getMdFile: options.getMdFile,
    listPresetsData: options.listPresetsData,
    scoreByQuery: options.scoreByQuery,
    lowRelevanceScoreThreshold: options.lowRelevanceScoreThreshold,
    registeredToolMetadata: options.registeredToolMetadata,
    createPreset: options.createPreset,
    getPreset: options.getPreset,
    isPresetDisabled: options.isPresetDisabled,
    buildPrompt: options.buildPrompt,
    evaluatePromptMetrics: options.evaluatePromptMetrics
  };
}

function buildMemoryAndSearchDeps(options: BuildRegisterAllToolsDepsOptions): MemoryAndSearchDeps {
  return {
    ensureDir: options.ensureDir,
    addMemory: options.addMemory,
    searchMemory: options.searchMemory,
    listMemory: options.listMemory,
    clearMemory: options.clearMemory,
    recordFailureMemory: options.recordFailureMemory,
    searchFailureMemory: options.searchFailureMemory,
    listFailureMemory: options.listFailureMemory,
    findMdFilesRecursive: options.findMdFilesRecursive,
    toPosixPath: options.toPosixPath,
    addRecord: options.addRecord,
    searchByKeyword: options.searchByKeyword,
    ...(options.searchByKeywordAsync ? { searchByKeywordAsync: options.searchByKeywordAsync } : {})
  };
}

function buildCatalogAndCustomToolDeps(
  options: BuildRegisterAllToolsDepsOptions
): CatalogAndCustomToolDeps {
  return {
    presetsDir: options.presetsDir,
    toolProposalsDir: options.toolProposalsDir,
    customToolsDir: options.customToolsDir,
    governanceFile: options.governanceFile,
    listSkillsCatalog: options.listSkillsCatalog,
    listPresetsCatalog: options.listPresetsCatalog,
    listToolsCatalog: options.listToolsCatalog,
    validateAndCreateSkillWithQuality: options.validateAndCreateSkillWithQuality,
    validateAndCreatePresetWithQuality: options.validateAndCreatePresetWithQuality,
    validateAndCreateToolWithQuality: options.validateAndCreateToolWithQuality,
    registerCustomTool: options.registerCustomTool,
    unregisterCustomTool: options.unregisterCustomTool,
    refreshDisabledToolsCache: options.refreshDisabledToolsCache
  };
}

export function buildRegisterAllToolsDepsFromOptions(
  options: BuildRegisterAllToolsDepsOptions
): RegisterAllToolsDeps {
  return {
    ...buildCoreAndSessionDeps(options),
    ...buildGovernanceDeps(options),
    ...buildPresetAndPromptDeps(options),
    ...buildMemoryAndSearchDeps(options),
    ...buildCatalogAndCustomToolDeps(options)
  };
}