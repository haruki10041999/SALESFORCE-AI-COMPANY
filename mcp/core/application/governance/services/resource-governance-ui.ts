import { renderGovernanceUi } from "../../../governance/governance-ui.js";
import type { GovernanceState } from "../../../governance/governance-state.js";
import type { OutputsPort } from "../../../ports/outputs-port.js";

export async function executeRenderGovernanceUi(args: {
  format?: "html" | "markdown" | "json";
  topPerType?: number;
  title?: string;
  write?: boolean;
  outputsDir: string;
  loadGovernanceState: () => Promise<GovernanceState>;
  outputsPort: OutputsPort;
}): Promise<{ text: string }> {
  const state = await args.loadGovernanceState();
  const report = renderGovernanceUi(state, { topPerType: args.topPerType, title: args.title });

  const dashboardsDir = `${args.outputsDir}/dashboards`;
  const shouldWrite = args.write === true;
  if (shouldWrite) {
    await args.outputsPort.writeArtifact("dashboards/governance.html", report.html, { contentType: "text/html" });
    await args.outputsPort.writeArtifact("dashboards/governance.md", report.markdown, { contentType: "text/markdown" });
    await args.outputsPort.writeArtifact("dashboards/governance.json", `${JSON.stringify({
      generatedAt: report.generatedAt,
      thresholds: report.thresholds,
      sections: report.sections,
      totals: report.totals
    }, null, 2)}\n`, { contentType: "application/json" });
  }

  const fmt = args.format ?? "json";
  const text =
    fmt === "html" ? report.html
    : fmt === "markdown" ? report.markdown
    : JSON.stringify({
        generatedAt: report.generatedAt,
        thresholds: report.thresholds,
        sections: report.sections,
        totals: report.totals,
        writtenTo: shouldWrite ? dashboardsDir : null,
        persisted: shouldWrite,
        persistenceNotice: shouldWrite
          ? `dashboard files were written to ${dashboardsDir}`
          : "write=true is not provided; dashboard file persistence is skipped"
      }, null, 2);

  return { text };
}
