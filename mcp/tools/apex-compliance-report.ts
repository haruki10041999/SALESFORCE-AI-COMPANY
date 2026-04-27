/**
 * T-ADD-08: Apex コンプライアンス統合レポート。
 *
 * 単一の入力 (Apex ファイル一覧) から以下を集約する:
 *   - apex-dependency-graph: クラス間依存
 *   - security-rule-scan: セキュリティ違反
 *   - apex-perf-predict: パフォーマンスリスク
 *
 * 重い I/O は呼び出し側 (handler) が担当し、本関数は受け取った成果物を
 * 1 つのレポートにまとめるだけの純粋関数。
 */
import type { ApexDependencyGraphResult } from "./apex-dependency-graph.js";
import type { SecurityScanResult, SecurityScanIssue } from "./security-rule-scan.js";
import type { ApexPerfReport, ApexPerfFinding } from "./apex-perf-predict.js";

export interface ApexComplianceReportInput {
  rootPath: string;
  fileCount: number;
  dependency: ApexDependencyGraphResult;
  security: SecurityScanResult;
  performance: ApexPerfReport;
}

export interface ApexComplianceReport {
  rootPath: string;
  generatedAt: string;
  fileCount: number;
  summary: {
    dependencyEdges: number;
    securityIssues: number;
    securityHigh: number;
    perfFindings: number;
    perfHigh: number;
    overallRiskScore: number;
  };
  highSeverityIssues: SecurityScanIssue[];
  highRiskPerformance: ApexPerfFinding[];
  topDependents: Array<{ name: string; inDegree: number }>;
}

export function buildApexComplianceReport(input: ApexComplianceReportInput): ApexComplianceReport {
  const sec = input.security;
  const perf = input.performance;

  // 上位被参照クラス Top 5
  const inDegree = new Map<string, number>();
  for (const edge of input.dependency.edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  const topDependents = [...inDegree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, n]) => ({ name, inDegree: n }));

  const securityHigh = sec.issuesBySeverity.high ?? 0;
  const perfHigh = perf.findingsByRisk.high ?? 0;
  const overallRiskScore =
    securityHigh * 5 +
    (sec.issuesBySeverity.medium ?? 0) * 2 +
    (sec.issuesBySeverity.low ?? 0) * 1 +
    perfHigh * 4 +
    (perf.findingsByRisk.medium ?? 0) * 2 +
    (perf.findingsByRisk.low ?? 0) * 1;

  return {
    rootPath: input.rootPath,
    generatedAt: new Date().toISOString(),
    fileCount: input.fileCount,
    summary: {
      dependencyEdges: input.dependency.edges.length,
      securityIssues: sec.totalIssues,
      securityHigh,
      perfFindings: perf.findings.length,
      perfHigh,
      overallRiskScore
    },
    highSeverityIssues: sec.issues.filter((i) => i.severity === "high"),
    highRiskPerformance: perf.findings.filter((f) => f.risk === "high"),
    topDependents
  };
}
