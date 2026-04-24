import { existsSync, promises as fsPromises } from "node:fs";
import { join, resolve } from "node:path";
import {
  analyzePermissionSet,
  parsePermissionSetCapabilities,
  type PermissionSetCapabilities
} from "./permission-set-analyzer.js";
import { diffPermissionSet, type PermissionSetDiffResult } from "./permission-set-diff.js";

export type PermissionUsageSignals = {
  objects?: string[];
  fields?: string[];
  apexClasses?: string[];
  systemPermissions?: string[];
};

export type RecommendPermissionSetsInput = {
  permissionSetFiles: string[];
  usage?: PermissionUsageSignals;
  usageLogFile?: string;
  currentPermissionSetFile?: string;
  objectAccessLevel?: "read" | "edit" | "create" | "delete";
  maxRecommendations?: number;
  reportOutputDir?: string;
};

export type PermissionSetRecommendation = {
  permissionSetFile: string;
  coverage: {
    requiredCount: number;
    satisfiedCount: number;
    ratio: number;
  };
  missing: {
    objects: string[];
    fields: string[];
    apexClasses: string[];
    systemPermissions: string[];
  };
  excess: {
    objectCount: number;
    fieldCount: number;
    apexClassCount: number;
    systemPermissionCount: number;
    totalCount: number;
  };
  riskHints: string[];
  score: number;
  diffFromCurrent?: Pick<PermissionSetDiffResult, "summary" | "missingInTarget" | "excessiveInTarget">;
};

export type RecommendPermissionSetsResult = {
  generatedAt: string;
  usageSummary: {
    objectCount: number;
    fieldCount: number;
    apexClassCount: number;
    systemPermissionCount: number;
    source: "input" | "log" | "merged";
  };
  requiredAccess: {
    objectAccessLevel: "read" | "edit" | "create" | "delete";
    objects: string[];
    fields: string[];
    apexClasses: string[];
    systemPermissions: string[];
  };
  recommendationCount: number;
  recommendations: PermissionSetRecommendation[];
  reportJsonPath: string;
  reportMarkdownPath: string;
  summary: string;
};

function toSet(values: unknown): Set<string> {
  if (!Array.isArray(values)) {
    return new Set<string>();
  }
  return new Set(values.filter((row): row is string => typeof row === "string").map((row) => row.trim()).filter(Boolean));
}

function parseLogRow(target: {
  objects: Set<string>;
  fields: Set<string>;
  apexClasses: Set<string>;
  systemPermissions: Set<string>;
}, row: Record<string, unknown>): void {
  const objectKeys = ["object", "objectApiName", "objectName", "sobject", "entity", "usedObject"];
  const fieldKeys = ["field", "fieldApiName", "fieldName", "usedField"];
  const apexKeys = ["apexClass", "apexClassName", "className", "usedApex"];
  const systemPermissionKeys = ["systemPermission", "permission", "systemPermissionName"];

  for (const key of objectKeys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      target.objects.add(value.trim());
    }
  }
  for (const key of fieldKeys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      target.fields.add(value.trim());
    }
  }
  for (const key of apexKeys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      target.apexClasses.add(value.trim());
    }
  }
  for (const key of systemPermissionKeys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      target.systemPermissions.add(value.trim());
    }
  }

  for (const value of toSet(row.usedObjects)) target.objects.add(value);
  for (const value of toSet(row.usedFields)) target.fields.add(value);
  for (const value of toSet(row.usedApexClasses)) target.apexClasses.add(value);
  for (const value of toSet(row.usedSystemPermissions)) target.systemPermissions.add(value);

  const payload = row.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    parseLogRow(target, payload as Record<string, unknown>);
  }
}

async function loadUsageFromLog(filePath: string): Promise<PermissionUsageSignals> {
  if (!existsSync(filePath)) {
    return {};
  }

  const raw = await fsPromises.readFile(filePath, "utf-8");
  const acc = {
    objects: new Set<string>(),
    fields: new Set<string>(),
    apexClasses: new Set<string>(),
    systemPermissions: new Set<string>()
  };

  for (const line of raw.split(/\r?\n/).map((row) => row.trim()).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parseLogRow(acc, parsed as Record<string, unknown>);
      }
    } catch {
      // ignore malformed log lines
    }
  }

  return {
    objects: [...acc.objects],
    fields: [...acc.fields],
    apexClasses: [...acc.apexClasses],
    systemPermissions: [...acc.systemPermissions]
  };
}

function evaluateObjectSatisfied(
  capability: PermissionSetCapabilities,
  objectName: string,
  accessLevel: "read" | "edit" | "create" | "delete"
): boolean {
  const objectPermission = capability.objectPermissions.get(objectName);
  if (!objectPermission) {
    return false;
  }

  if (accessLevel === "read") return objectPermission.allowRead;
  if (accessLevel === "edit") return objectPermission.allowEdit;
  if (accessLevel === "create") return objectPermission.allowCreate;
  return objectPermission.allowDelete;
}

function evaluateFieldSatisfied(
  capability: PermissionSetCapabilities,
  fieldName: string,
  accessLevel: "read" | "edit" | "create" | "delete"
): boolean {
  const fieldPermission = capability.fieldPermissions.get(fieldName);
  if (!fieldPermission) {
    return false;
  }

  if (accessLevel === "edit" || accessLevel === "create") {
    return fieldPermission.editable;
  }

  return fieldPermission.readable;
}

function buildMarkdown(result: RecommendPermissionSetsResult): string {
  const lines: string[] = [];
  lines.push("# Permission Set Recommendations");
  lines.push("");
  lines.push(`- generatedAt: ${result.generatedAt}`);
  lines.push(`- usageSource: ${result.usageSummary.source}`);
  lines.push(`- requiredObjects: ${result.requiredAccess.objects.length}`);
  lines.push(`- requiredFields: ${result.requiredAccess.fields.length}`);
  lines.push(`- requiredApexClasses: ${result.requiredAccess.apexClasses.length}`);
  lines.push(`- recommendationCount: ${result.recommendationCount}`);
  lines.push("");

  if (result.recommendations.length === 0) {
    lines.push("No recommendation candidates were produced.");
    return lines.join("\n");
  }

  lines.push("| permissionSet | score | coverage | missing | excess | riskHints |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const row of result.recommendations) {
    const missing =
      row.missing.objects.length +
      row.missing.fields.length +
      row.missing.apexClasses.length +
      row.missing.systemPermissions.length;
    lines.push(
      `| ${row.permissionSetFile} | ${row.score.toFixed(2)} | ${(row.coverage.ratio * 100).toFixed(1)}% | ${missing} | ${row.excess.totalCount} | ${row.riskHints.length} |`
    );
  }

  return lines.join("\n");
}

export async function recommendPermissionSets(input: RecommendPermissionSetsInput): Promise<RecommendPermissionSetsResult> {
  if (!Array.isArray(input.permissionSetFiles) || input.permissionSetFiles.length === 0) {
    throw new Error("permissionSetFiles must include at least one file path");
  }

  const logUsage = input.usageLogFile ? await loadUsageFromLog(input.usageLogFile) : {};
  const usage = input.usage ?? {};

  const objects = new Set([...(usage.objects ?? []), ...(logUsage.objects ?? [])].map((row) => row.trim()).filter(Boolean));
  const fields = new Set([...(usage.fields ?? []), ...(logUsage.fields ?? [])].map((row) => row.trim()).filter(Boolean));
  const apexClasses = new Set([...(usage.apexClasses ?? []), ...(logUsage.apexClasses ?? [])].map((row) => row.trim()).filter(Boolean));
  const systemPermissions = new Set([...(usage.systemPermissions ?? []), ...(logUsage.systemPermissions ?? [])].map((row) => row.trim()).filter(Boolean));

  const usageSource: RecommendPermissionSetsResult["usageSummary"]["source"] =
    input.usage && input.usageLogFile ? "merged" : input.usage ? "input" : "log";

  if (objects.size + fields.size + apexClasses.size + systemPermissions.size === 0) {
    throw new Error("No usage signals found. Provide usage or usageLogFile.");
  }

  const objectAccessLevel = input.objectAccessLevel ?? "read";
  const requiredCount = objects.size + fields.size + apexClasses.size + systemPermissions.size;
  const recommendations: PermissionSetRecommendation[] = [];

  for (const permissionSetFile of input.permissionSetFiles) {
    const capability = parsePermissionSetCapabilities(permissionSetFile);
    const analysis = analyzePermissionSet(permissionSetFile);

    const missingObjects = [...objects].filter((name) => !evaluateObjectSatisfied(capability, name, objectAccessLevel));
    const missingFields = [...fields].filter((name) => !evaluateFieldSatisfied(capability, name, objectAccessLevel));
    const missingApex = [...apexClasses].filter((name) => !capability.apexClasses.has(name));
    const missingSystem = [...systemPermissions].filter((name) => !capability.systemPermissions.has(name));

    const satisfiedCount = requiredCount - (missingObjects.length + missingFields.length + missingApex.length + missingSystem.length);

    const excessObjectCount = [...capability.objectPermissions.keys()].filter((name) => !objects.has(name)).length;
    const excessFieldCount = [...capability.fieldPermissions.keys()].filter((name) => !fields.has(name)).length;
    const excessApexClassCount = [...capability.apexClasses].filter((name) => !apexClasses.has(name)).length;
    const excessSystemPermissionCount = [...capability.systemPermissions].filter((name) => !systemPermissions.has(name)).length;
    const excessTotal = excessObjectCount + excessFieldCount + excessApexClassCount + excessSystemPermissionCount;

    const coverageRatio = requiredCount > 0 ? satisfiedCount / requiredCount : 0;
    const riskPenalty = analysis.riskHints.length * 1.5;
    const score = Number((coverageRatio * 100 - excessTotal * 0.05 - riskPenalty).toFixed(3));

    const recommendation: PermissionSetRecommendation = {
      permissionSetFile,
      coverage: {
        requiredCount,
        satisfiedCount,
        ratio: Number(coverageRatio.toFixed(4))
      },
      missing: {
        objects: missingObjects,
        fields: missingFields,
        apexClasses: missingApex,
        systemPermissions: missingSystem
      },
      excess: {
        objectCount: excessObjectCount,
        fieldCount: excessFieldCount,
        apexClassCount: excessApexClassCount,
        systemPermissionCount: excessSystemPermissionCount,
        totalCount: excessTotal
      },
      riskHints: analysis.riskHints,
      score
    };

    if (input.currentPermissionSetFile) {
      const diff = diffPermissionSet({
        baselineFilePath: input.currentPermissionSetFile,
        targetFilePath: permissionSetFile,
        sampleLimit: 20
      });
      recommendation.diffFromCurrent = {
        summary: diff.summary,
        missingInTarget: diff.missingInTarget,
        excessiveInTarget: diff.excessiveInTarget
      };
    }

    recommendations.push(recommendation);
  }

  recommendations.sort((a, b) => b.score - a.score || b.coverage.ratio - a.coverage.ratio || a.excess.totalCount - b.excess.totalCount);

  const limit = Number.isFinite(input.maxRecommendations)
    ? Math.max(1, Math.min(50, Math.floor(input.maxRecommendations as number)))
    : 10;
  const selected = recommendations.slice(0, limit);

  const generatedAt = new Date().toISOString();
  const reportDir = resolve(input.reportOutputDir ?? join("outputs", "reports"));
  await fsPromises.mkdir(reportDir, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const reportJsonPath = join(reportDir, `permission-set-recommendations-${stamp}.json`);
  const reportMarkdownPath = join(reportDir, `permission-set-recommendations-${stamp}.md`);

  const result: RecommendPermissionSetsResult = {
    generatedAt,
    usageSummary: {
      objectCount: objects.size,
      fieldCount: fields.size,
      apexClassCount: apexClasses.size,
      systemPermissionCount: systemPermissions.size,
      source: usageSource
    },
    requiredAccess: {
      objectAccessLevel,
      objects: [...objects],
      fields: [...fields],
      apexClasses: [...apexClasses],
      systemPermissions: [...systemPermissions]
    },
    recommendationCount: selected.length,
    recommendations: selected,
    reportJsonPath,
    reportMarkdownPath,
    summary: [
      `requiredSignals: ${requiredCount}`,
      `candidates: ${input.permissionSetFiles.length}`,
      `recommendations: ${selected.length}`,
      `bestScore: ${selected[0]?.score ?? 0}`
    ].join("\n")
  };

  await fsPromises.writeFile(reportJsonPath, JSON.stringify(result, null, 2), "utf-8");
  await fsPromises.writeFile(reportMarkdownPath, buildMarkdown(result), "utf-8");

  return result;
}
