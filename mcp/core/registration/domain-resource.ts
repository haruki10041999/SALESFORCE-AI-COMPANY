import { join } from "node:path";
import {
  registerResourceGovernanceTools,
  registerResourceActionTools,
  registerAnalyticsTools
} from "../../handlers/index.js";
import { registerResourceSearchTools } from "../../handlers/register-resource-search-tools.js";
import type { GovernanceState } from "../governance/governance-state.js";
import type { SystemEventName } from "../event/system-event-manager.js";
import type { registerAllTools } from "./register-all-tools.js";
import type { CleanupSchedule } from "../resource/cleanup-scheduler.js";

type Deps = Parameters<typeof registerAllTools>[0];
const CLEANUP_SCHEDULER_QUEUE = "governance-auto-cleanup";

function buildCleanupScheduleSync(proposalQueue: Deps["proposalQueue"]): {
  upsert: (schedule: CleanupSchedule) => Promise<void>;
  remove: (scheduleId: string) => Promise<void>;
} | undefined {
  if (typeof proposalQueue.scheduleRecurringJob !== "function" || typeof proposalQueue.unscheduleRecurringJob !== "function") {
    return undefined;
  }
  return {
    upsert: async (schedule: CleanupSchedule) => {
      if (schedule.status !== "active") {
        await proposalQueue.unscheduleRecurringJob?.({
          queue: CLEANUP_SCHEDULER_QUEUE,
          key: schedule.id
        });
        return;
      }
      await proposalQueue.scheduleRecurringJob?.({
        queue: CLEANUP_SCHEDULER_QUEUE,
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
    },
    remove: async (scheduleId: string) => {
      await proposalQueue.unscheduleRecurringJob?.({
        queue: CLEANUP_SCHEDULER_QUEUE,
        key: scheduleId
      });
    }
  };
}

/** Resource search / governance / actions / analytics を登録する。 */
export function registerResourceDomain(deps: Deps): void {
  const {
    govTool,
    loadGovernanceState,
    saveGovernanceState,
    listMdFiles,
    listPresetsData,
    scoreByQuery,
    emitSystemEvent,
    lowRelevanceScoreThreshold,
    registeredToolMetadata,
    agentLog,
    loadChatHistories,
    loadSystemEvents,
    getSystemEventLogStatus,
    generateHandlersDashboard,
    handlersState,
    exportStatisticsAsCsv,
    exportStatisticsAsJson,
    ensureDir,
    runChatTool,
    evaluatePromptMetrics,
    root,
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
    createPreset,
    registerCustomTool,
    unregisterCustomTool,
    refreshDisabledToolsCache,
    appendOperationLog,
    emitEvent,
    toPosixPath,
    resourceScore,
    proposalQueue
  } = deps;

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
    outputsDir: join(root, "outputs"),
    policySnapshotManager: deps.policySnapshotManager
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
    emitSystemEvent,
    proposalQueue
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
    cleanupScheduleSync: buildCleanupScheduleSync(proposalQueue),
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
