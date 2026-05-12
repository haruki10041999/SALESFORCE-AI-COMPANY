import { promises as fsPromises } from "fs";

export async function persistAbHistoryAnalysis(args: {
  reportDir?: string;
  analysisPath: string;
  payload: unknown;
  writeArtifactJson: (path: string, payload: unknown) => Promise<void>;
}): Promise<void> {
  if (args.reportDir) {
    await fsPromises.writeFile(args.analysisPath, JSON.stringify(args.payload, null, 2), "utf-8");
    return;
  }

  await args.writeArtifactJson("reports/agent-ab-test/analysis-latest.json", args.payload);
}
