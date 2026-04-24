import type { CreatedResourceTracker } from "../../handlers/resource/resource-created.handler.js";
import type { DeletedResourceTracker } from "../../handlers/resource/resource-deleted.handler.js";
import type { ErrorAggregateTracker } from "../../handlers/governance/error-aggregate.handler.js";
import type { QualityCheckFailureTracker } from "../../handlers/governance/quality-check-failed.handler.js";

/**
 * Handlers dashboard state
 */
export interface HandlersDashboardState {
  createdTracker: CreatedResourceTracker;
  deletedTracker: DeletedResourceTracker;
  errorTracker: ErrorAggregateTracker;
  qualityTracker: QualityCheckFailureTracker;
}

/**
 * Statistics export data
 */
export interface ExportStatistics {
  created: CreatedResourceTracker;
  deleted: DeletedResourceTracker;
  errors: ErrorAggregateTracker;
  qualityFailures: QualityCheckFailureTracker;
  lastUpdated: string;
}
