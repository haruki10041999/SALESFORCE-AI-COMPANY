import type { ExportStatistics } from "../../../types/index.js";

export function buildExportStatisticsPayload(input: {
  createdTracker: ExportStatistics["created"];
  deletedTracker: ExportStatistics["deleted"];
  errorTracker: ExportStatistics["errors"];
  qualityTracker: ExportStatistics["qualityFailures"];
}): ExportStatistics {
  return {
    created: input.createdTracker,
    deleted: input.deletedTracker,
    errors: input.errorTracker,
    qualityFailures: input.qualityTracker,
    lastUpdated: new Date().toISOString()
  };
}

export function buildExportStatisticsContent(args: {
  format?: "json" | "csv";
  stats: ExportStatistics;
  toCsv: (stats: ExportStatistics) => string;
  toJson: (stats: ExportStatistics) => string;
}): string {
  return args.format === "csv"
    ? args.toCsv(args.stats)
    : args.toJson(args.stats);
}