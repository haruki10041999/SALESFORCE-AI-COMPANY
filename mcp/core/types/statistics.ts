/**
 * Handlers dashboard state (flexible structure for runtime trackers)
 * Note: actual runtime types are complex (CreatedResourceTracker, etc.)
 * Use 'any' to accommodate runtime tracker objects
 */
export interface HandlersDashboardState {
  createdTracker: any;
  deletedTracker: any;
  errorTracker: any;
  qualityTracker: any;
}

/**
 * Statistics export data
 */
export interface ExportStatistics {
  created: any;
  deleted: any;
  errors: any;
  qualityFailures: any;
  lastUpdated: string;
}
