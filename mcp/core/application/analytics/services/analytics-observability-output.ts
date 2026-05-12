export const OBSERVABILITY_HTML_RELATIVE_PATH = "dashboards/observability.html";
export const OBSERVABILITY_MARKDOWN_RELATIVE_PATH = "dashboards/observability.md";
export const OBSERVABILITY_JSON_RELATIVE_PATH = "dashboards/observability.json";

interface ObservabilityReportLike {
  html: string;
  markdown: string;
  summary: unknown;
  correlations: unknown;
  governanceFlagged: unknown;
}

export async function persistObservabilityDashboard(args: {
  shouldWrite: boolean;
  report: ObservabilityReportLike;
  writeText: (path: string, content: string) => Promise<void>;
  writeJson: (path: string, payload: unknown) => Promise<void>;
}): Promise<void> {
  if (!args.shouldWrite) {
    return;
  }

  await args.writeText(OBSERVABILITY_HTML_RELATIVE_PATH, args.report.html);
  await args.writeText(OBSERVABILITY_MARKDOWN_RELATIVE_PATH, args.report.markdown);
  await args.writeJson(OBSERVABILITY_JSON_RELATIVE_PATH, {
    summary: args.report.summary,
    correlations: args.report.correlations,
    governanceFlagged: args.report.governanceFlagged
  });
}

export function buildObservabilityOutputText(args: {
  format: "html" | "markdown" | "json";
  report: ObservabilityReportLike;
  dashboardsDir: string;
  shouldWrite: boolean;
}): string {
  if (args.format === "html") {
    return args.report.html;
  }
  if (args.format === "markdown") {
    return args.report.markdown;
  }
  return JSON.stringify(
    {
      summary: args.report.summary,
      correlations: args.report.correlations,
      governanceFlagged: args.report.governanceFlagged,
      writtenTo: args.shouldWrite ? args.dashboardsDir : null,
      persisted: args.shouldWrite,
      persistenceNotice: args.shouldWrite
        ? `dashboard files were written to ${args.dashboardsDir}`
        : "write=true is not provided; dashboard file persistence is skipped"
    },
    null,
    2
  );
}
