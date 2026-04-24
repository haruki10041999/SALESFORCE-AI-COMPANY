export type ComparisonOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "in"
  | "isBlank"
  | "notBlank";

export type LogicOperator = "all" | "any";

export type FlowConditionNode =
  | {
      op: LogicOperator;
      conditions: FlowConditionNode[];
    }
  | {
      op: ComparisonOperator;
      field: string;
      value?: unknown;
    };

  type FlowLogicNode = Extract<FlowConditionNode, { op: LogicOperator }>;
  type FlowComparisonNode = Extract<FlowConditionNode, { op: ComparisonOperator }>;

export type FlowConditionSimulationInput = {
  flowName?: string;
  record: Record<string, unknown>;
  condition: FlowConditionNode;
};

export type FlowConditionSimulationResult = {
  flowName: string;
  shouldTrigger: boolean;
  evaluatedAt: string;
  summary: string;
  unmetConditions: string[];
  trace: Array<{
    path: string;
    op: string;
    field?: string;
    expected?: unknown;
    actual?: unknown;
    result: boolean;
  }>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeComparable(value: unknown): number | string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";

    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
      return asNumber;
    }

    const asDate = Date.parse(trimmed);
    if (!Number.isNaN(asDate)) {
      return asDate;
    }

    return trimmed.toLowerCase();
  }
  return String(value).toLowerCase();
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

function assertFieldName(field: unknown, path: string): asserts field is string {
  if (typeof field !== "string" || !field.trim()) {
    throw new Error(`field は空でない文字列が必要です: ${path}`);
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(field)) {
    throw new Error(`field に使用できない文字があります: ${path}`);
  }
}

function assertNodeShape(node: unknown, path: string): asserts node is FlowConditionNode {
  if (!isObject(node)) {
    throw new Error(`condition node は object である必要があります: ${path}`);
  }

  if (node.op === "all" || node.op === "any") {
    if (!Array.isArray(node.conditions) || node.conditions.length === 0) {
      throw new Error(`logic node には1件以上の conditions が必要です: ${path}`);
    }
    node.conditions.forEach((child, index) => assertNodeShape(child, `${path}.conditions[${index}]`));
    return;
  }

  const op = node.op;
  const validOps = new Set<ComparisonOperator>([
    "eq",
    "ne",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "in",
    "isBlank",
    "notBlank"
  ]);
  if (typeof op !== "string" || !validOps.has(op as ComparisonOperator)) {
    throw new Error(`未知の op です: ${path}`);
  }

  assertFieldName(node.field, `${path}.field`);

  if ((op === "in") && !Array.isArray(node.value)) {
    throw new Error(`op=in の value は配列である必要があります: ${path}`);
  }
}

function getFieldValue(record: Record<string, unknown>, field: string): unknown {
  const segments = field.split(".");
  let current: unknown = record;

  for (const segment of segments) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

function compare(op: ComparisonOperator, actual: unknown, expected: unknown): boolean {
  if (op === "isBlank") return isBlank(actual);
  if (op === "notBlank") return !isBlank(actual);

  if (op === "contains") {
    if (typeof actual === "string") {
      return typeof expected === "string" && actual.toLowerCase().includes(expected.toLowerCase());
    }
    if (Array.isArray(actual)) {
      return actual.some((item) => item === expected);
    }
    return false;
  }

  if (op === "in") {
    if (!Array.isArray(expected)) return false;
    return expected.some((item) => item === actual);
  }

  const a = normalizeComparable(actual);
  const b = normalizeComparable(expected);

  if (a === null || b === null) {
    if (op === "eq") return a === b;
    if (op === "ne") return a !== b;
    return false;
  }

  switch (op) {
    case "eq":
      return a === b;
    case "ne":
      return a !== b;
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
    default:
      return false;
  }
}

function evaluateNode(
  node: FlowConditionNode,
  record: Record<string, unknown>,
  path: string,
  trace: FlowConditionSimulationResult["trace"],
  unmetConditions: string[]
): boolean {
  if (node.op === "all" || node.op === "any") {
    const logicNode = node as FlowLogicNode;
    const childResults = logicNode.conditions.map((child, index) =>
      evaluateNode(child, record, `${path}.conditions[${index}]`, trace, unmetConditions)
    );

    const result = logicNode.op === "all" ? childResults.every(Boolean) : childResults.some(Boolean);
    trace.push({ path, op: logicNode.op, result });
    return result;
  }

  const comparisonNode = node as FlowComparisonNode;
  const actual = getFieldValue(record, comparisonNode.field);
  const result = compare(comparisonNode.op, actual, comparisonNode.value);

  trace.push({
    path,
    op: comparisonNode.op,
    field: comparisonNode.field,
    expected: comparisonNode.value,
    actual,
    result
  });

  if (!result) {
    unmetConditions.push(`${comparisonNode.field} ${comparisonNode.op} ${JSON.stringify(comparisonNode.value)}`);
  }

  return result;
}

export function simulateFlowCondition(input: FlowConditionSimulationInput): FlowConditionSimulationResult {
  if (!isObject(input.record)) {
    throw new Error("record は object である必要があります。");
  }

  assertNodeShape(input.condition, "condition");

  const trace: FlowConditionSimulationResult["trace"] = [];
  const unmetConditions: string[] = [];
  const shouldTrigger = evaluateNode(input.condition, input.record, "condition", trace, unmetConditions);
  const flowName = input.flowName?.trim() || "UnnamedFlow";

  return {
    flowName,
    shouldTrigger,
    evaluatedAt: new Date().toISOString(),
    summary: shouldTrigger
      ? `Flow '${flowName}' は条件を満たしたため起動対象です。`
      : `Flow '${flowName}' は条件を満たさないため起動対象外です。`,
    unmetConditions,
    trace
  };
}
