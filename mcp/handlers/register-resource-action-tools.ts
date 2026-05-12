import type { GovernanceState } from "../core/governance/governance-state.js";
import type { ChatPreset, CustomToolDefinition, ResourceOperation } from "../core/types/index.js";
import type { RegisterGovToolDeps } from "./types.js";
import type { SystemEventType } from "../core/event/event-dispatcher.js";
import type { SystemEventRecord } from "../core/event/system-event-manager.js";
import type { HandlersStatistics } from "./statistics-manager.js";
import { type CleanupSchedule } from "../core/resource/cleanup-scheduler.js";
import { defineApplyResourceActionsTool } from "./core-resource-apply/apply-resource-actions.js";
import { defineSuggestCleanupResourcesTool } from "./core-resource-cleanup/suggest-cleanup-resources.js";
import { defineGovernanceAutoCleanupScheduleTool } from "./core-resource-cleanup/governance-auto-cleanup-schedule.js";

interface RegisterResourceActionToolsDeps extends RegisterGovToolDeps {
  root: string;
  presetsDir: string;
  toolProposalsDir: string;
  customToolsDir: string;
  governanceFile: string;
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  ensureDir: (path: string) => Promise<void>;
  loadRecentOperations: () => Promise<ResourceOperation[]>;
  checkDailyLimitExceeded: (ops: ResourceOperation[], action: "create" | "delete", limit: number) => boolean;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
  validateAndCreateSkillWithQuality: (name: string, content: string, state: GovernanceState) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  validateAndCreatePresetWithQuality: (name: string, preset: { description: string; agents: string[]; topic: string }, state: GovernanceState) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  validateAndCreateToolWithQuality: (name: string, description: string, state: GovernanceState) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  createPreset: (preset: ChatPreset) => Promise<void>;
  registerCustomTool: (tool: CustomToolDefinition) => void;
  unregisterCustomTool: (name: string) => void;
  refreshDisabledToolsCache: () => Promise<void>;
  appendOperationLog: (op: ResourceOperation) => Promise<void>;
  emitEvent: (event: { type: SystemEventType; timestamp: string; payload: Record<string, unknown> }) => Promise<void>;
  toPosixPath: (pathValue: string) => string;
  loadSystemEvents: (limit?: number, event?: string) => Promise<SystemEventRecord[]>;
  handlersStatistics: HandlersStatistics;
  cleanupScheduleSync?: {
    upsert: (schedule: CleanupSchedule) => Promise<void>;
    remove: (scheduleId: string) => Promise<void>;
  };
}

export function registerResourceActionTools(deps: RegisterResourceActionToolsDeps): void {
  const {
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
    loadSystemEvents,
    handlersStatistics,
    cleanupScheduleSync
  } = deps;

  // core-resource-apply
  defineApplyResourceActionsTool({
    ...deps,
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
    toPosixPath
  });

  // core-resource-cleanup
  defineSuggestCleanupResourcesTool({
    ...deps,
    customToolsDir,
    governanceFile,
    loadGovernanceState,
    listSkillsCatalog,
    listPresetsCatalog,
    loadSystemEvents,
    handlersStatistics,
    toPosixPath
  });

  defineGovernanceAutoCleanupScheduleTool({
    ...deps,
    root,
    cleanupScheduleSync
  });
}
