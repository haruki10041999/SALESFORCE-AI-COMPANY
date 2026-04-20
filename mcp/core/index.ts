/**
 * Core Module Exports
 */

// Resource Selection
export {
  type ResourceType,
  type ResourceSelectionResult,
  type ResourceScoreDetail,
  type ResourceCandidate,
  type ScoringConfig,
  DEFAULT_SCORING_CONFIG,
  scoreCandidate,
  calculateScoreBreakdown,
  selectResources,
  selectResourcesByType
} from "./resource/resource-selector.js";

// Gap Detection
export {
  type GapDetectionResult,
  type GapEvent,
  detectGap,
  createGapEvent,
  detectGapsForTopic
} from "./resource/resource-gap-detector.js";

// Resource Suggestion
export {
  type ResourceSuggestion,
  suggestResource,
  suggestResourcesForGaps,
  normalizeResourceSuggestion
} from "./resource/resource-suggester.js";

// Quality Checking
export {
  type QualityCheckResult,
  type QualityError,
  type QualityWarning,
  SKILL_QUALITY_REQUIREMENTS,
  TOOL_QUALITY_REQUIREMENTS,
  PRESET_QUALITY_REQUIREMENTS,
  checkSkillQuality,
  checkToolQuality,
  checkPresetQuality,
  checkResourceQuality
} from "./quality/quality-checker.js";

// Deduplication
export {
  type SimilarityCheckResult,
  calculateSimilarity,
  checkForDuplicates,
  checkNameDuplicate,
  generateUniqueName,
  findDuplicateGroups
} from "./quality/deduplication.js";

// Event Dispatcher
export {
  type SystemEventType,
  type SystemEvent,
  type EventListener,
  EventDispatcher,
  getGlobalDispatcher,
  onEvent,
  emitEvent,
  getEventHistory,
  createEvent,
  createGapDetectedEvent,
  createResourceCreatedEvent,
  createResourceDeletedEvent,
  createQualityCheckFailedEvent
} from "./event/event-dispatcher.js";

// Governance Manager
export {
  type ResourceScore,
  type GovernanceConfig,
  DEFAULT_GOVERNANCE_CONFIG,
  type ResourceOperation,
  type UsageRecord,
  type BugSignalRecord,
  calculateResourceScore,
  assessRiskLevel,
  shouldRecommendDeletion,
  shouldRecommendDisable,
  checkDailyLimitExceeded,
  isAtCapacity,
  isOverCapacity,
  suggestDeletionCandidates,
  suggestDisableCandidates
} from "./governance/governance-manager.js";
