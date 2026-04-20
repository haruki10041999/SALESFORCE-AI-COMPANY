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
