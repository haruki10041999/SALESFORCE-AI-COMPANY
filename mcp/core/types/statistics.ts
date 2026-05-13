export interface CreatedResourceTracker {
  totalCreated: number;
  createdByType: Record<"skills" | "tools" | "presets", number>;
  createdBySource: Record<string, number>;
  lastCreatedResources: Array<{
    resourceType: string;
    name: string;
    timestamp: string;
    source?: string;
  }>;
}

export interface DeletedResourceRecord {
  resourceType: "skills" | "tools" | "presets";
  name: string;
  timestamp: string;
  reason?: string;
}

export interface DeletedResourceTracker {
  deletedResources: DeletedResourceRecord[];
  deletedByType: Record<"skills" | "tools" | "presets", number>;
  deletionHistory: Array<{
    date: string;
    count: number;
  }>;
}

export interface ToolErrorRecord {
  toolName: string;
  errorCount: number;
  lastError?: string;
  lastErrorTime?: string;
  errorHistory: Array<{
    error: string;
    timestamp: string;
  }>;
}

export interface ErrorAggregateTracker {
  toolErrors: Map<string, ToolErrorRecord>;
  aggregateWindow: number;
  aggregateThreshold: number;
}

export interface QualityFailureRecord {
  resourceType: "skills" | "tools" | "presets";
  resourceName: string;
  errors: string[];
  timestamp: string;
}

export interface QualityCheckFailureTracker {
  failures: QualityFailureRecord[];
  failuresByResource: Map<string, number>;
  failuresByType: Record<"skills" | "tools" | "presets", number>;
}

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
