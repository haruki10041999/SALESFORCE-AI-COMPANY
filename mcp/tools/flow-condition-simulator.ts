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
    throw new Error(`field ã¯ç©ºã§ãªã„æ–‡å­—åˆ—ãŒå¿…è¦ã§ã™: ${path}`);
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(field)) {
    throw new Error(`field ã«ä½¿ç”¨ã§ããªã„æ–‡å­—ãŒã‚ã‚Šã¾ã™: ${path}`);
  }
}

function assertNodeShape(node: unknown, path: string): asserts node is FlowConditionNode {
  if (!isObject(node)) {
    throw new Error(`condition node ã¯ object ã§ã‚ã‚‹å¿…è¦ãŒã‚ã‚Šã¾ã™: ${path}`);
  }

  if (node.op === "all" || node.op === "any") {
    if (!Array.isArray(node.conditions) || node.conditions.length === 0) {
      throw new Error(`logic node ã«ã¯1ä»¶ä»¥ä¸Šã® conditions ãŒå¿…è¦ã§ã™: ${path}`);
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
    throw new Error(`æœªçŸ¥ã® op ã§ã™: ${path}`);
  }

  assertFieldName(node.field, `${path}.field`);

  if ((op === "in") && !Array.isArray(node.value)) {
    throw new Error(`op=in ã® value ã¯é…åˆ—ã§ã‚ã‚‹å¿…è¦ãŒã‚ã‚Šã¾ã™: ${path}`);
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
    throw new Error("record ã¯ object ã§ã‚ã‚‹å¿…è¦ãŒã‚ã‚Šã¾ã™ã€‚");
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
      ? `Flow '${flowName}' ã¯æ¡ä»¶ã‚’æº€ãŸã—ãŸãŸã‚èµ·å‹•å¯¾è±¡ã§ã™ã€‚`
      : `Flow '${flowName}' ã¯æ¡ä»¶ã‚’æº€ãŸã•ãªã„ãŸã‚èµ·å‹•å¯¾è±¡å¤–ã§ã™ã€‚`,
    unmetConditions,
    trace
  };
}

/**
 * ğŒ®‚É“oê‚·‚é `field` ‚ğ’Šo‚·‚é (d•¡‚ğœŠO)B
 */
export function extractFlowConditionFields(node: FlowConditionNode): string[] {
  const seen = new Set<string>();
  const visit = (n: FlowConditionNode): void => {
    if (n.op === "all" || n.op === "any") {
      for (const c of (n as FlowLogicNode).conditions) visit(c);
      return;
    }
    const cmp = n as FlowComparisonNode;
    if (cmp.field) seen.add(cmp.field);
  };
  visit(node);
  return [...seen].sort();
}

/**
 * —^‚¦‚ç‚ê‚½ `field => value Œó•â”z—ñ` ‚Ì‘g‡‚¹‚ğ‘“–‚½‚è‚µ‚ÄA
 * ‚»‚ê‚¼‚ê‚Ì‘g‚İ‡‚í‚¹‚ğ simulateFlowCondition() ‚É’Ê‚µ‚½Œ‹‰Ê‚ğ•Ô‚·B
 *
 * ‘g‚İ‡‚í‚¹”‚Í’lŒó•â‚ÌÏ‚Å”š”­‚·‚é‚½‚ßA`maxCombinations` (Šù’è 256) ‚Å‘Å‚¿Ø‚éB
 * ‘S‘g‡‚¹‚ªãŒÀˆÈ“à‚Éû‚Ü‚éê‡‚Ì‚İ truncated=falseB
 */
export interface FlowConditionMatrixOptions {
  flowName?: string;
  fieldDomains: Record<string, unknown[]>;
  baseRecord?: Record<string, unknown>;
  maxCombinations?: number;
}

export interface FlowConditionMatrixRow {
  record: Record<string, unknown>;
  shouldTrigger: boolean;
}

export interface FlowConditionMatrixSummary {
  totalEvaluated: number;
  triggerTrueCount: number;
  triggerFalseCount: number;
  truncated: boolean;
  rows: FlowConditionMatrixRow[];
}

export function enumerateFlowConditionMatrix(
  condition: FlowConditionNode,
  options: FlowConditionMatrixOptions
): FlowConditionMatrixSummary {
  const max = Math.max(1, Math.floor(options.maxCombinations ?? 256));
  const fields = Object.keys(options.fieldDomains);
  let total = 1;
  for (const f of fields) total *= Math.max(1, options.fieldDomains[f].length);
  const truncated = total > max;
  const limit = Math.min(total, max);

  const rows: FlowConditionMatrixRow[] = [];
  let triggerTrue = 0;
  for (let i = 0; i < limit; i++) {
    const record: Record<string, unknown> = { ...(options.baseRecord ?? {}) };
    let idx = i;
    for (const f of fields) {
      const domain = options.fieldDomains[f];
      const size = Math.max(1, domain.length);
      record[f] = domain[idx % size];
      idx = Math.floor(idx / size);
    }
    const result = simulateFlowCondition({
      flowName: options.flowName,
      record,
      condition
    });
    if (result.shouldTrigger) triggerTrue += 1;
    rows.push({ record, shouldTrigger: result.shouldTrigger });
  }

  return {
    totalEvaluated: rows.length,
    triggerTrueCount: triggerTrue,
    triggerFalseCount: rows.length - triggerTrue,
    truncated,
    rows
  };
}
