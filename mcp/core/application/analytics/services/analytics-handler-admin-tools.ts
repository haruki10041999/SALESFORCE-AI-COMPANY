import { dirname, resolve } from "node:path";
import { promises as fsPromises } from "node:fs";
import type { ExportStatistics, HandlersDashboardState } from "../../../types/index.js";
import { buildHandlersDashboardMarkdown } from "./analytics-markdown.js";
import {
  buildExportStatisticsContent,
  buildExportStatisticsPayload
} from "./analytics-handler-stats-export.js";

export async function executeGetHandlersDashboardTool(args: {
  generateHandlersDashboard: (state: HandlersDashboardState) => HandlersDashboardState;
  handlersState: HandlersDashboardState;
}): Promise<Array<{ type: string; text: string }>> {
  const dashboard = args.generateHandlersDashboard(args.handlersState);
  const markdown = buildHandlersDashboardMarkdown({
    createdTracker: dashboard.createdTracker,
    errorTracker: dashboard.errorTracker
  });

  return [
    { type: "text", text: JSON.stringify(dashboard, null, 2) },
    { type: "text", text: markdown }
  ];
}

export async function executeExportHandlersStatisticsTool(args: {
  format?: "json" | "csv";
  outputPath?: string;
  handlersState: HandlersDashboardState;
  toCsv: (stats: ExportStatistics) => string;
  toJson: (stats: ExportStatistics) => string;
  ensureDir: (dir: string) => Promise<void>;
}): Promise<string> {
  const stats = buildExportStatisticsPayload({
    createdTracker: args.handlersState.createdTracker,
    deletedTracker: args.handlersState.deletedTracker,
    errorTracker: args.handlersState.errorTracker,
    qualityTracker: args.handlersState.qualityTracker
  });
  const content = buildExportStatisticsContent({
    format: args.format,
    stats,
    toCsv: args.toCsv,
    toJson: args.toJson
  });

  if (args.outputPath) {
    const destination = resolve(args.outputPath);
    await args.ensureDir(dirname(destination));
    await fsPromises.writeFile(destination, content, "utf-8");
  }

  return content;
}
