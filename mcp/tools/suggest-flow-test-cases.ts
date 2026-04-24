import { promises as fsPromises } from "node:fs";
import { basename, join, resolve } from "node:path";
import { analyzeFlow, type FlowFileAnalysis } from "./flow-analyzer.js";
import {
  simulateFlowCondition,
  type ComparisonOperator,
  type FlowConditionNode,
  type FlowConditionSimulationResult
} from "./flow-condition-simulator.js";

export type SuggestFlowTestCasesInput = {
  filePath: string;
  coveredPaths?: string[];
  maxCases?: number;
  reportOutputDir?: string;
  includeDefaultPaths?: boolean;
};

type ParsedRuleCondition = {
  field: string;
  op: ComparisonOperator;
  expected?: unknown;
};

type ParsedRulePath = {
  pathId: string;
  decisionName: string;
  ruleName: string;
  isDefaultPath: boolean;
  conditions: ParsedRuleCondition[];
  logic: "all" | "any";
};

export type FlowTestCaseSuggestion = {
  pathId: string;
  decisionName: string;
  ruleName: string;
  isDefaultPath: boolean;
  reason: string;
  conditionTree?: FlowConditionNode;
  sampleRecord?: Record<string, unknown>;
  simulation?: Pick<FlowConditionSimulationResult, "shouldTrigger" | "summary" | "unmetConditions" | "trace">;
};

export type SuggestFlowTestCasesResult = {
  flowName: string;
  filePath: string;
  generatedAt: string;
  flowAnalysis: FlowFileAnalysis;
  coveredPaths: string[];
  totalPathCount: number;
  uncoveredPathCount: number;
  uncoveredPaths: string[];
  suggestedCases: FlowTestCaseSuggestion[];
  reportJsonPath: string;
  reportMarkdownPath: string;
  summary: string;
};

function extractTag(block: string, tagName: string): string | null {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"));
  return match?.[1]?.trim() ?? null;
}

function extractBlocks(source: string, tagName: string): string[] {
  const matches = source.matchAll(new RegExp(`<${tagName}(?:>|\\s[^>]*>)([\\s\\S]*?)</${tagName}>`, "gi"));
  return [...matches].map((row) => row[1]);
}

function normalizeFieldReference(raw: string): string {
  const stripped = raw
    .replace(/^\{!/, "")
    .replace(/}$/, "")
    .replace(/^\$Record\./, "record.")
    .replace(/^record\./, "record.")
    .trim();

  return stripped.length > 0 ? stripped : "record.unknown";
}

function mapOperator(raw: string | null): ComparisonOperator | null {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "equalto":
      return "eq";
    case "notequalto":
      return "ne";
    case "greaterthan":
      return "gt";
    case "greaterthanorequalto":
      return "gte";
    case "lessthan":
      return "lt";
    case "lessthanorequalto":
      return "lte";
    case "contains":
      return "contains";
    case "in":
      return "in";
    case "isblank":
    case "isnull":
      return "isBlank";
    case "notblank":
    case "isnotblank":
    case "isnotnull":
      return "notBlank";
    default:
      return null;
  }
}

function parseRightValue(conditionBlock: string): unknown {
  const rightValue = extractTag(conditionBlock, "rightValue") ?? conditionBlock;
  const stringValue = extractTag(rightValue, "stringValue");
  if (stringValue !== null) return stringValue;

  const numberValue = extractTag(rightValue, "numberValue");
  if (numberValue !== null) {
    const parsed = Number(numberValue);
    if (Number.isFinite(parsed)) return parsed;
  }

  const booleanValue = extractTag(rightValue, "booleanValue");
  if (booleanValue !== null) {
    return booleanValue.trim().toLowerCase() === "true";
  }

  const dateTimeValue = extractTag(rightValue, "dateTimeValue");
  if (dateTimeValue !== null) return dateTimeValue;

  const dateValue = extractTag(rightValue, "dateValue");
  if (dateValue !== null) return dateValue;

  const value = extractTag(rightValue, "value");
  if (value !== null) return value;

  return undefined;
}

function parseFlowPaths(source: string, flowName: string, includeDefaultPaths: boolean): ParsedRulePath[] {
  const paths: ParsedRulePath[] = [];

  for (const decisionBlock of extractBlocks(source, "decisions")) {
    const decisionName = extractTag(decisionBlock, "name") ?? "UnnamedDecision";

    for (const ruleBlock of extractBlocks(decisionBlock, "rules")) {
      const ruleName = extractTag(ruleBlock, "name") ?? "UnnamedRule";
      const rawLogic = (extractTag(ruleBlock, "conditionLogic") ?? "and").toLowerCase();
      const logic: "all" | "any" = rawLogic.includes("or") ? "any" : "all";

      const conditions: ParsedRuleCondition[] = [];
      for (const conditionBlock of extractBlocks(ruleBlock, "conditions")) {
        const field = normalizeFieldReference(extractTag(conditionBlock, "leftValueReference") ?? "record.unknown");
        const op = mapOperator(extractTag(conditionBlock, "operator"));
        if (!op) {
          continue;
        }
        const expected = parseRightValue(conditionBlock);
        const condition: ParsedRuleCondition = {
          field,
          op
        };
        if (expected !== undefined) {
          condition.expected = expected;
        }
        conditions.push(condition);
      }

      if (conditions.length === 0) {
        continue;
      }

      paths.push({
        pathId: `${decisionName}.${ruleName}`,
        decisionName,
        ruleName,
        isDefaultPath: false,
        conditions,
        logic
      });
    }

    if (includeDefaultPaths) {
      const hasDefault = Boolean(extractTag(decisionBlock, "defaultConnector") || extractTag(decisionBlock, "defaultConnectorLabel"));
      if (hasDefault) {
        paths.push({
          pathId: `${decisionName}.Default`,
          decisionName,
          ruleName: "Default",
          isDefaultPath: true,
          conditions: [],
          logic: "all"
        });
      }
    }
  }

  if (paths.length === 0) {
    throw new Error(`Flow '${flowName}' から decision rules を抽出できませんでした。`);
  }

  return paths;
}

function buildConditionTree(path: ParsedRulePath): FlowConditionNode | undefined {
  if (path.conditions.length === 0) {
    return undefined;
  }

  const leafNodes: FlowConditionNode[] = path.conditions.map((condition) => ({
    op: condition.op,
    field: condition.field,
    value: condition.expected
  }));

  if (leafNodes.length === 1) {
    return leafNodes[0];
  }

  return {
    op: path.logic,
    conditions: leafNodes
  };
}

function withDifferentValue(value: unknown): unknown {
  if (typeof value === "number") {
    return value + 1;
  }
  if (typeof value === "boolean") {
    return !value;
  }
  if (typeof value === "string") {
    return `${value}_other`;
  }
  return "other";
}

function sampleValueForCondition(condition: ParsedRuleCondition): unknown {
  switch (condition.op) {
    case "eq":
      return condition.expected ?? "sample";
    case "ne":
      return withDifferentValue(condition.expected);
    case "gt":
      return typeof condition.expected === "number" ? condition.expected + 1 : 1;
    case "gte":
      return typeof condition.expected === "number" ? condition.expected : 1;
    case "lt":
      return typeof condition.expected === "number" ? condition.expected - 1 : -1;
    case "lte":
      return typeof condition.expected === "number" ? condition.expected : 0;
    case "contains":
      return typeof condition.expected === "string" ? `prefix-${condition.expected}-suffix` : "contains-value";
    case "in": {
      if (Array.isArray(condition.expected) && condition.expected.length > 0) {
        return condition.expected[0];
      }
      if (typeof condition.expected === "string" && condition.expected.length > 0) {
        const [first] = condition.expected.split(",");
        return first.trim();
      }
      return "in-value";
    }
    case "isBlank":
      return null;
    case "notBlank":
      return "value";
    default:
      return "sample";
  }
}

function setNested(record: Record<string, unknown>, fieldPath: string, value: unknown): void {
  const segments = fieldPath.split(".").filter(Boolean);
  if (segments.length === 0) {
    return;
  }

  let current: Record<string, unknown> = record;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (i === segments.length - 1) {
      current[segment] = value;
      return;
    }

    const next = current[segment];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      const created: Record<string, unknown> = {};
      current[segment] = created;
      current = created;
      continue;
    }

    current = next as Record<string, unknown>;
  }
}

function buildSampleRecord(path: ParsedRulePath): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const condition of path.conditions) {
    setNested(record, condition.field, sampleValueForCondition(condition));
  }
  return record;
}

function toMarkdown(result: SuggestFlowTestCasesResult): string {
  const lines: string[] = [];
  lines.push("# Flow Suggested Test Cases");
  lines.push("");
  lines.push(`- flowName: ${result.flowName}`);
  lines.push(`- generatedAt: ${result.generatedAt}`);
  lines.push(`- totalPathCount: ${result.totalPathCount}`);
  lines.push(`- uncoveredPathCount: ${result.uncoveredPathCount}`);
  lines.push(`- coveredPaths: ${result.coveredPaths.length}`);
  lines.push("");

  if (result.suggestedCases.length === 0) {
    lines.push("No uncovered paths detected.");
    return lines.join("\n");
  }

  lines.push("| pathId | decision | rule | default | shouldTrigger | reason | unmetConditions |\n|---|---|---|---|---|---|---|");
  for (const row of result.suggestedCases) {
    lines.push(
      `| ${row.pathId} | ${row.decisionName} | ${row.ruleName} | ${row.isDefaultPath ? "yes" : "no"} | ${row.simulation?.shouldTrigger ?? "-"} | ${row.reason} | ${(row.simulation?.unmetConditions.length ?? 0)} |`
    );
  }

  return lines.join("\n");
}

export async function suggestFlowTestCases(input: SuggestFlowTestCasesInput): Promise<SuggestFlowTestCasesResult> {
  const flowAnalysis = analyzeFlow(input.filePath);
  const source = await fsPromises.readFile(input.filePath, "utf-8");

  const flowName =
    extractTag(source, "label") ??
    extractTag(source, "fullName") ??
    basename(input.filePath).replace(/\.flow-meta\.xml$/i, "");

  const allPaths = parseFlowPaths(source, flowName, input.includeDefaultPaths ?? false);
  const coveredSet = new Set((input.coveredPaths ?? []).map((row) => row.trim()).filter((row) => row.length > 0));
  const uncoveredPaths = allPaths.filter((path) => !coveredSet.has(path.pathId));

  const limit = Number.isFinite(input.maxCases) ? Math.max(1, Math.min(200, Math.floor(input.maxCases as number))) : 50;
  const suggestions: FlowTestCaseSuggestion[] = [];

  for (const path of uncoveredPaths.slice(0, limit)) {
    if (path.isDefaultPath) {
      suggestions.push({
        pathId: path.pathId,
        decisionName: path.decisionName,
        ruleName: path.ruleName,
        isDefaultPath: true,
        reason: "default path coverage is missing; add a case where all named rules are false"
      });
      continue;
    }

    const conditionTree = buildConditionTree(path);
    if (!conditionTree) {
      continue;
    }

    const sampleRecord = buildSampleRecord(path);
    const simulation = simulateFlowCondition({
      flowName,
      record: sampleRecord,
      condition: conditionTree
    });

    suggestions.push({
      pathId: path.pathId,
      decisionName: path.decisionName,
      ruleName: path.ruleName,
      isDefaultPath: false,
      reason: "rule path has no recorded coverage",
      conditionTree,
      sampleRecord,
      simulation: {
        shouldTrigger: simulation.shouldTrigger,
        summary: simulation.summary,
        unmetConditions: simulation.unmetConditions,
        trace: simulation.trace
      }
    });
  }

  const generatedAt = new Date().toISOString();
  const reportDir = resolve(input.reportOutputDir ?? join("outputs", "reports"));
  await fsPromises.mkdir(reportDir, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const reportJsonPath = join(reportDir, `flow-test-cases-${stamp}.json`);
  const reportMarkdownPath = join(reportDir, `flow-test-cases-${stamp}.md`);

  const result: SuggestFlowTestCasesResult = {
    flowName,
    filePath: input.filePath,
    generatedAt,
    flowAnalysis,
    coveredPaths: [...coveredSet],
    totalPathCount: allPaths.length,
    uncoveredPathCount: uncoveredPaths.length,
    uncoveredPaths: uncoveredPaths.map((path) => path.pathId),
    suggestedCases: suggestions,
    reportJsonPath,
    reportMarkdownPath,
    summary: [
      `flowName: ${flowName}`,
      `totalPathCount: ${allPaths.length}`,
      `uncoveredPathCount: ${uncoveredPaths.length}`,
      `suggestedCases: ${suggestions.length}`
    ].join("\n")
  };

  await fsPromises.writeFile(reportJsonPath, JSON.stringify(result, null, 2), "utf-8");
  await fsPromises.writeFile(reportMarkdownPath, toMarkdown(result), "utf-8");

  return result;
}
