import type { MetadataDependencyResult, DependencyTarget } from "../../tools/metadata-dependency-graph.js";

export type ImpactDomain = "apex" | "flow" | "permission" | "lwc" | "other";

export interface DependencyImpactItem {
  target: string;
  kind: "CustomField" | "CustomObject";
  status: "A" | "M" | "D";
  risk: "high" | "medium" | "low";
  referenceCount: number;
  impactScore: number;
  impactedDomains: ImpactDomain[];
  sourcePath: string;
}

export interface DependencyImpactSummary {
  totalTargets: number;
  totalReferences: number;
  totalImpactScore: number;
  riskCounts: Record<"high" | "medium" | "low", number>;
  domainCounts: Record<ImpactDomain, number>;
}

export interface DependencyImpactSimulationResult {
  comparison: string;
  summary: DependencyImpactSummary;
  items: DependencyImpactItem[];
  recommendations: string[];
}

function statusWeight(status: "A" | "M" | "D"): number {
  if (status === "D") return 5;
  if (status === "M") return 3;
  return 2;
}

function riskWeight(risk: "high" | "medium" | "low"): number {
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  return 1;
}

function kindWeight(kind: "CustomField" | "CustomObject"): number {
  return kind === "CustomObject" ? 1.5 : 1.2;
}

function inferDomainsFromTarget(target: DependencyTarget): ImpactDomain[] {
  const out = new Set<ImpactDomain>();
  for (const ref of target.references) {
    const p = ref.filePath.toLowerCase();
    if (p.endsWith(".cls") || p.endsWith(".trigger")) out.add("apex");
    if (p.endsWith(".flow-meta.xml")) out.add("flow");
    if (p.endsWith(".permissionset-meta.xml") || p.endsWith(".profile-meta.xml")) out.add("permission");
    if (p.includes("/lwc/") || p.endsWith(".js") || p.endsWith(".ts")) out.add("lwc");
  }

  if (out.size === 0) {
    out.add("other");
  }
  return [...out];
}

function scoreImpact(target: DependencyTarget): number {
  const base = statusWeight(target.status) * riskWeight(target.risk) * kindWeight(target.kind);
  const refFactor = Math.min(10, target.references.length + 1);
  return Number((base * refFactor).toFixed(2));
}

function buildRecommendations(summary: DependencyImpactSummary): string[] {
  const recommendations: string[] = [];

  if (summary.riskCounts.high > 0) {
    recommendations.push("High risk targets detected. Prioritize manual review and staged deployment.");
  }
  if (summary.domainCounts.permission > 0) {
    recommendations.push("Permission-related impact detected. Run recommend_permission_sets before deploy.");
  }
  if (summary.domainCounts.flow > 0) {
    recommendations.push("Flow impact detected. Execute flow_condition_simulate and suggest_flow_test_cases.");
  }
  if (summary.totalImpactScore >= 80) {
    recommendations.push("Impact score is high. Split rollout and add rollback checkpoints.");
  }

  if (recommendations.length === 0) {
    recommendations.push("No major impact signal detected. Continue with normal verification pipeline.");
  }

  return recommendations;
}

export function simulateDependencyImpact(graph: MetadataDependencyResult): DependencyImpactSimulationResult {
  const items: DependencyImpactItem[] = graph.targets.map((target) => {
    const impactedDomains = inferDomainsFromTarget(target);
    return {
      target: target.apiName,
      kind: target.kind,
      status: target.status,
      risk: target.risk,
      referenceCount: target.references.length,
      impactScore: scoreImpact(target),
      impactedDomains,
      sourcePath: target.sourcePath
    };
  }).sort((a, b) => b.impactScore - a.impactScore);

  const riskCounts: Record<"high" | "medium" | "low", number> = {
    high: 0,
    medium: 0,
    low: 0
  };
  const domainCounts: Record<ImpactDomain, number> = {
    apex: 0,
    flow: 0,
    permission: 0,
    lwc: 0,
    other: 0
  };

  for (const item of items) {
    riskCounts[item.risk] += 1;
    for (const domain of item.impactedDomains) {
      domainCounts[domain] += 1;
    }
  }

  const summary: DependencyImpactSummary = {
    totalTargets: items.length,
    totalReferences: items.reduce((acc, item) => acc + item.referenceCount, 0),
    totalImpactScore: Number(items.reduce((acc, item) => acc + item.impactScore, 0).toFixed(2)),
    riskCounts,
    domainCounts
  };

  return {
    comparison: graph.comparison,
    summary,
    items,
    recommendations: buildRecommendations(summary)
  };
}
