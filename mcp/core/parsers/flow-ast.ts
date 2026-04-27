/**
 * F-09: Flow AST analyzer
 *
 * Salesforce Flow XML (.flow / .flow-meta.xml) を `fast-xml-parser` で構文解析し、
 * 既存の regex ベース flow-analyzer を強化する AST レベルの抽出を提供する。
 *
 * - 副作用なし。XML 文字列を受け取り、構造化サマリを返す純粋関数。
 * - Decision の各ルール条件 / Subflow / ActionCall / RecordCreate/Update/Delete
 *   などのノード一覧を保持する。
 * - 既存 `mcp/tools/flow-analyzer.ts` と並存させ、より詳細な情報が要る箇所で利用する。
 */

import { XMLParser, XMLValidator } from "fast-xml-parser";

export type FlowTriggerType = "RecordBeforeSave" | "RecordAfterSave" | "Scheduled" | "PlatformEvent" | "Standard" | string;

export interface FlowCondition {
  leftValueReference?: string;
  operator?: string;
  rightValueLiteral?: string;
  rightValueReference?: string;
}

export interface FlowDecisionRule {
  name: string;
  label?: string;
  conditionLogic?: string;
  connector?: string;
  conditions: FlowCondition[];
}

export interface FlowDecisionNode {
  name: string;
  label?: string;
  defaultConnector?: string;
  rules: FlowDecisionRule[];
}

export interface FlowActionCallNode {
  name: string;
  label?: string;
  actionName?: string;
  actionType?: string;
  apexClass?: string;
  isApex: boolean;
}

export interface FlowSubflowNode {
  name: string;
  label?: string;
  flowName?: string;
}

export interface FlowRecordOpNode {
  name: string;
  label?: string;
  object?: string;
  /** create / update / delete / lookup */
  op: "create" | "update" | "delete" | "lookup";
}

export interface FlowScreenNode {
  name: string;
  label?: string;
}

export interface FlowFormulaNode {
  name: string;
  expression?: string;
  dataType?: string;
}

export interface FlowDocument {
  apiVersion?: string;
  label?: string;
  status?: string;
  triggerType?: FlowTriggerType;
  startObject?: string;
  decisions: FlowDecisionNode[];
  actionCalls: FlowActionCallNode[];
  subflows: FlowSubflowNode[];
  recordOps: FlowRecordOpNode[];
  screens: FlowScreenNode[];
  formulas: FlowFormulaNode[];
  scheduledPathCount: number;
}

export interface FlowAnalysisCounts {
  decisionCount: number;
  screenCount: number;
  recordCreateCount: number;
  recordUpdateCount: number;
  recordDeleteCount: number;
  recordLookupCount: number;
  subflowCount: number;
  apexActionCount: number;
  formulaCount: number;
}

export interface FlowAnalysis {
  document: FlowDocument;
  counts: FlowAnalysisCounts;
  riskHints: string[];
  /** XML スキーマ妥当性チェック (well-formed のみ) */
  isWellFormed: boolean;
  parseErrors: string[];
}

const XML_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (_name: string): boolean => false
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function pickText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const text = (value as { "#text"?: unknown })["#text"];
    if (typeof text === "string") return text.trim() || undefined;
  }
  return undefined;
}

function buildDecisions(raw: unknown): FlowDecisionNode[] {
  const items = asArray(raw);
  return items.map((d) => {
    const decision = d as Record<string, unknown>;
    const rules = asArray(decision.rules).map((r) => {
      const rule = r as Record<string, unknown>;
      const conditions = asArray(rule.conditions).map((c) => {
        const cond = c as Record<string, unknown>;
        const out: FlowCondition = {};
        const lvr = pickText(cond.leftValueReference);
        if (lvr) out.leftValueReference = lvr;
        const op = pickText(cond.operator);
        if (op) out.operator = op;
        const rvl = pickText((cond.rightValue as Record<string, unknown> | undefined)?.stringValue) ??
          pickText((cond.rightValue as Record<string, unknown> | undefined)?.numberValue) ??
          pickText((cond.rightValue as Record<string, unknown> | undefined)?.booleanValue);
        if (rvl) out.rightValueLiteral = rvl;
        const rvr = pickText((cond.rightValue as Record<string, unknown> | undefined)?.elementReference);
        if (rvr) out.rightValueReference = rvr;
        return out;
      });
      const result: FlowDecisionRule = {
        name: pickText(rule.name) ?? "",
        conditions
      };
      const label = pickText(rule.label);
      if (label) result.label = label;
      const cl = pickText(rule.conditionLogic);
      if (cl) result.conditionLogic = cl;
      const conn = pickText((rule.connector as Record<string, unknown> | undefined)?.targetReference);
      if (conn) result.connector = conn;
      return result;
    });
    const node: FlowDecisionNode = {
      name: pickText(decision.name) ?? "",
      rules
    };
    const label = pickText(decision.label);
    if (label) node.label = label;
    const dc = pickText((decision.defaultConnector as Record<string, unknown> | undefined)?.targetReference);
    if (dc) node.defaultConnector = dc;
    return node;
  });
}

function buildActionCalls(raw: unknown): FlowActionCallNode[] {
  return asArray(raw).map((a) => {
    const action = a as Record<string, unknown>;
    const actionType = pickText(action.actionType);
    const node: FlowActionCallNode = {
      name: pickText(action.name) ?? "",
      isApex: actionType?.toLowerCase() === "apex"
    };
    const label = pickText(action.label);
    if (label) node.label = label;
    const an = pickText(action.actionName);
    if (an) node.actionName = an;
    if (actionType) node.actionType = actionType;
    const ac = pickText(action.apexClass);
    if (ac) node.apexClass = ac;
    return node;
  });
}

function buildSubflows(raw: unknown): FlowSubflowNode[] {
  return asArray(raw).map((s) => {
    const sub = s as Record<string, unknown>;
    const node: FlowSubflowNode = { name: pickText(sub.name) ?? "" };
    const label = pickText(sub.label);
    if (label) node.label = label;
    const fn = pickText(sub.flowName);
    if (fn) node.flowName = fn;
    return node;
  });
}

function buildRecordOps(raw: Record<string, unknown>): FlowRecordOpNode[] {
  const out: FlowRecordOpNode[] = [];
  const map: Array<{ key: string; op: FlowRecordOpNode["op"] }> = [
    { key: "recordCreates", op: "create" },
    { key: "recordUpdates", op: "update" },
    { key: "recordDeletes", op: "delete" },
    { key: "recordLookups", op: "lookup" }
  ];
  for (const { key, op } of map) {
    for (const r of asArray(raw[key])) {
      const node = r as Record<string, unknown>;
      const item: FlowRecordOpNode = {
        name: pickText(node.name) ?? "",
        op
      };
      const label = pickText(node.label);
      if (label) item.label = label;
      const o = pickText(node.object);
      if (o) item.object = o;
      out.push(item);
    }
  }
  return out;
}

function buildScreens(raw: unknown): FlowScreenNode[] {
  return asArray(raw).map((s) => {
    const screen = s as Record<string, unknown>;
    const node: FlowScreenNode = { name: pickText(screen.name) ?? "" };
    const label = pickText(screen.label);
    if (label) node.label = label;
    return node;
  });
}

function buildFormulas(raw: unknown): FlowFormulaNode[] {
  return asArray(raw).map((f) => {
    const formula = f as Record<string, unknown>;
    const node: FlowFormulaNode = { name: pickText(formula.name) ?? "" };
    const expr = pickText(formula.expression);
    if (expr) node.expression = expr;
    const dt = pickText(formula.dataType);
    if (dt) node.dataType = dt;
    return node;
  });
}

function countScheduledPaths(flowRoot: Record<string, unknown>): number {
  const start = flowRoot.start as Record<string, unknown> | undefined;
  if (!start) return 0;
  return asArray(start.scheduledPaths).length;
}

/**
 * Flow XML を {@link FlowDocument} へ変換する。
 */
export function parseFlowXml(xml: string): { document: FlowDocument; isWellFormed: boolean; parseErrors: string[] } {
  const parseErrors: string[] = [];
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  const isWellFormed = validation === true;
  if (!isWellFormed && typeof validation === "object" && validation.err) {
    parseErrors.push(`${validation.err.code} at line ${validation.err.line}: ${validation.err.msg}`);
  }

  const parser = new XMLParser(XML_OPTIONS);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    parseErrors.push(`xml parse failed: ${(err as Error)?.message ?? String(err)}`);
  }

  const flowRoot = (parsed.Flow ?? parsed.flow ?? {}) as Record<string, unknown>;
  const document: FlowDocument = {
    decisions: buildDecisions(flowRoot.decisions),
    actionCalls: buildActionCalls(flowRoot.actionCalls),
    subflows: buildSubflows(flowRoot.subflows),
    recordOps: buildRecordOps(flowRoot),
    screens: buildScreens(flowRoot.screens),
    formulas: buildFormulas(flowRoot.formulas),
    scheduledPathCount: countScheduledPaths(flowRoot)
  };
  const apiVersion = pickText(flowRoot.apiVersion);
  if (apiVersion) document.apiVersion = apiVersion;
  const label = pickText(flowRoot.label);
  if (label) document.label = label;
  const status = pickText(flowRoot.status);
  if (status) document.status = status;
  const start = flowRoot.start as Record<string, unknown> | undefined;
  const triggerType = pickText(start?.triggerType) ?? pickText(flowRoot.triggerType);
  if (triggerType) document.triggerType = triggerType;
  const startObject = pickText(start?.object);
  if (startObject) document.startObject = startObject;
  return { document, isWellFormed, parseErrors };
}

function buildCounts(doc: FlowDocument): FlowAnalysisCounts {
  let create = 0;
  let update = 0;
  let del = 0;
  let lookup = 0;
  for (const r of doc.recordOps) {
    if (r.op === "create") create += 1;
    else if (r.op === "update") update += 1;
    else if (r.op === "delete") del += 1;
    else if (r.op === "lookup") lookup += 1;
  }
  return {
    decisionCount: doc.decisions.length,
    screenCount: doc.screens.length,
    recordCreateCount: create,
    recordUpdateCount: update,
    recordDeleteCount: del,
    recordLookupCount: lookup,
    subflowCount: doc.subflows.length,
    apexActionCount: doc.actionCalls.filter((a) => a.isApex).length,
    formulaCount: doc.formulas.length
  };
}

function buildRiskHints(doc: FlowDocument, counts: FlowAnalysisCounts): string[] {
  const hints: string[] = [];
  const dmlTotal = counts.recordCreateCount + counts.recordUpdateCount + counts.recordDeleteCount;
  if (dmlTotal >= 5) {
    hints.push("DML相当処理が多いため、ガバナ制限と再入防止を確認してください。");
  }
  if (counts.subflowCount >= 3) {
    hints.push("Subflow数が多く、実行経路の追跡が複雑です。");
  }
  if (counts.apexActionCount > 0) {
    hints.push("Apexアクションを含むため、例外伝播とトランザクション境界を確認してください。");
  }
  if (doc.scheduledPathCount > 0) {
    hints.push("Scheduled path を含むため、重複実行と遅延実行時の整合性を確認してください。");
  }
  // 各 decision に default connector が無いと未捕捉分岐の恐れ
  const orphanDecisions = doc.decisions.filter((d) => !d.defaultConnector);
  if (orphanDecisions.length > 0) {
    hints.push(`${orphanDecisions.length} 個の Decision に defaultConnector が設定されていません。`);
  }
  return hints;
}

export function analyzeFlowAst(xml: string): FlowAnalysis {
  const { document, isWellFormed, parseErrors } = parseFlowXml(xml);
  const counts = buildCounts(document);
  const riskHints = buildRiskHints(document, counts);
  return { document, counts, riskHints, isWellFormed, parseErrors };
}
