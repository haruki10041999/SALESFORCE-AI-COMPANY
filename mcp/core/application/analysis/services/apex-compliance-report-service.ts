import { buildApexDependencyGraph } from "../../../../tools/apex-dependency-graph.js";
import { scanSecurityRules } from "../../../../tools/security-rule-scan.js";
import { predictApexPerformance } from "../../../../tools/apex-perf-predict.js";
import { buildApexComplianceReport } from "../../../../tools/apex-compliance-report.js";
import { collectApexSources } from "./apex-source-collector.js";

export function executeApexComplianceReport(args: {
  rootDir: string;
  includeTests?: boolean;
  sampleLimit?: number;
}): ReturnType<typeof buildApexComplianceReport> {
  const sources = collectApexSources(args.rootDir, args.includeTests, args.sampleLimit);
  const dependency = buildApexDependencyGraph({
    rootDir: args.rootDir,
    includeTests: args.includeTests,
    sampleLimit: args.sampleLimit
  });
  const security = scanSecurityRules(sources);
  const performance = predictApexPerformance(sources);
  return buildApexComplianceReport({
    rootPath: args.rootDir,
    fileCount: sources.length,
    dependency,
    security,
    performance
  });
}