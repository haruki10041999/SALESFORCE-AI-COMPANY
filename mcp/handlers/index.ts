/**
 * Handlers Module Exports
 */

// Resource Gap Handler
export {
  type HandlerExecutionResult,
  type HandlerConfig,
  DEFAULT_HANDLER_CONFIG,
  handleResourceGapDetected,
  handleMultipleGaps,
  summarizeResults
} from "./resource/resource-gap.handler.js";

// Resource Created Handler
export {
  type ResourceCreatedEvent,
  type CreatedResourceTracker,
  initializeCreatedResourceTracker,
  handleResourceCreated,
  generateCreationSummary,
  countCreationsInLastDay
} from "./resource/resource-created.handler.js";

// Resource Deleted Handler
export {
  type DeletedResourceRecord,
  type DeletedResourceTracker,
  initializeDeletedResourceTracker,
  recordResourceDeletion,
  getDeletionCountByType,
  getDeletionCountForDate,
  getRecentlyDeletedResources,
  detectDeletionPatterns,
  generateDeletionReport,
  wasRecentlyDeleted,
  resetDeletionStats
} from "./resource/resource-deleted.handler.js";

// Error Aggregate Handler
export {
  type ToolErrorRecord,
  type ErrorAggregateTracker,
  initializeErrorAggregateTracker,
  recordToolError,
  detectErrorAggregations,
  generateErrorReport,
  resetToolErrors,
  resetAllErrors,
  getToolLastError,
  getToolErrorCount
} from "./governance/error-aggregate.handler.js";

// Quality Check Failed Handler
export {
  type QualityFailureRecord,
  type QualityCheckFailureTracker,
  initializeQualityCheckFailureTracker,
  recordQualityCheckFailure,
  getResourceFailureCount,
  detectFailurePatterns,
  generateImprovementSuggestions,
  generateFailureReport,
  clearResourceFailures,
  clearAllFailures
} from "./governance/quality-check-failed.handler.js";

// Governance Threshold Handler
export {
  type ThresholdHandlerResult,
  type ThresholdHandlerConfig,
  DEFAULT_THRESHOLD_CONFIG,
  handleGovernanceThresholdExceeded,
  handleErrorAggregateDetected,
  handleGovernanceMultiple
} from "./governance/threshold.handler.js";

// Statistics Manager
export {
  type HandlersStatistics,
  initializeHandlersStatistics,
  generateHandlersStatisticsSummary,
  exportStatisticsAsCsv,
  exportStatisticsAsJson,
  updateStatisticsTimestamp
} from "./statistics-manager.js";

// Tool Registration Modules
export { registerLoggingTools } from "./register-logging-tools.js";
export { registerHistoryTools } from "./register-history-tools.js";
export { registerResourceGovernanceTools } from "./register-resource-governance-tools.js";
export { registerResourceActionTools } from "./register-resource-action-tools.js";
export { registerSmartChatTools } from "./register-smart-chat-tools.js";
export { registerAnalyticsTools } from "./register-analytics-tools.js";
export { registerExportTools } from "./register-export-tools.js";
export { registerMemoryTools } from "./register-memory-tools.js";
export { registerContextTools } from "./register-context-tools.js";
