/**
 * A10: Apex 性能予測 (heuristic perf prediction)
 *
 * Apex ソースの構文要素から、本番でガバナ制限に抵触しそうな
 * パターンをヒューリスティックに検知し、推定影響度をスコア化する。
 *
 * - SOQL inside loop → 高リスク
 * - DML inside loop → 高リスク
 * - Future / Queueable @future no params validation → 中リスク
 * - 100+ lines of single method → 中リスク
 * - nested loops > 2 levels → 中リスク
 * - .size() in loop condition → 低リスク
 *
 * 純粋関数。git や I/O は使わない。
 */

export interface ApexPerfInput {
  filePath: string;
  source: string;
}

export type ApexPerfRisk = "high" | "medium" | "low";

export interface ApexPerfFinding {
  filePath: string;
  line: number;
  rule: string;
  risk: ApexPerfRisk;
  message: string;
  estimatedImpactScore: number;
}

export interface ApexPerfReport {
  totalFiles: number;
  totalFindings: number;
  riskScore: number;
  findingsByRisk: { high: number; medium: number; low: number };
  findings: ApexPerfFinding[];
}

const SOQL_PATTERN = /\[\s*SELECT\b[^\]]+\bFROM\b/i;
const DML_PATTERN = /\b(?:insert|update|upsert|delete)\s+\w+\s*;/i;
const FOR_LOOP_PATTERN = /\bfor\s*\(/;
const WHILE_LOOP_PATTERN = /\bwhile\s*\(/;
const SIZE_IN_LOOP_PATTERN = /\bfor\s*\([^)]*\.size\s*\(/i;
const FUTURE_ANNOTATION = /^\s*@future\b/i;
const SCHEDULABLE_BATCH_PATTERN = /\b(?:Schedulable|Database\.Batchable)\b/;

const RISK_WEIGHT: Record<ApexPerfRisk, number> = { high: 5, medium: 2, low: 1 };

interface LoopContext {
  startLine: number;
  endLine: number;
  depth: number;
}

function findLoopBlocks(lines: string[]): LoopContext[] {
  const stack: LoopContext[] = [];
  const completed: LoopContext[] = [];
  let braceDepth = 0;
  const loopDepthStack: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const isLoopStart = FOR_LOOP_PATTERN.test(line) || WHILE_LOOP_PATTERN.test(line);
    if (isLoopStart) {
      loopDepthStack.push(braceDepth);
      stack.push({ startLine: i + 1, endLine: -1, depth: loopDepthStack.length });
    }
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    braceDepth += opens - closes;
    while (loopDepthStack.length > 0 && braceDepth <= loopDepthStack[loopDepthStack.length - 1]) {
      const popped = stack.pop();
      const dep = loopDepthStack.pop();
      if (popped && typeof dep === "number") {
        popped.endLine = i + 1;
        completed.push(popped);
      }
    }
  }
  // unfinished
  for (const s of stack) {
    s.endLine = lines.length;
    completed.push(s);
  }
  return completed;
}

function isInsideAnyLoop(lineNo: number, loops: LoopContext[]): LoopContext | null {
  for (const l of loops) {
    if (lineNo >= l.startLine && lineNo <= l.endLine) return l;
  }
  return null;
}

function detectMethodLengths(lines: string[]): Array<{ startLine: number; lengthLines: number }> {
  const result: Array<{ startLine: number; lengthLines: number }> = [];
  let methodStart = -1;
  let depth = 0;
  let inMethod = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!inMethod && /\b(?:public|private|protected|global|static)\b[^=;{}]*\([^)]*\)\s*\{/i.test(line)) {
      methodStart = i + 1;
      inMethod = true;
      depth = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      continue;
    }
    if (inMethod) {
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (depth <= 0) {
        result.push({ startLine: methodStart, lengthLines: i + 1 - methodStart + 1 });
        inMethod = false;
        methodStart = -1;
      }
    }
  }
  return result;
}

function scanFile(input: ApexPerfInput): ApexPerfFinding[] {
  const findings: ApexPerfFinding[] = [];
  const lines = input.source.split(/\r?\n/);
  const loops = findLoopBlocks(lines);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;
    const inLoop = isInsideAnyLoop(lineNo, loops);
    if (SOQL_PATTERN.test(line) && inLoop) {
      findings.push({
        filePath: input.filePath,
        line: lineNo,
        rule: "soql-in-loop",
        risk: "high",
        message: "ループ内 SOQL は 101 件制限に抵触する可能性があります。bulkify してください。",
        estimatedImpactScore: 10
      });
    }
    if (DML_PATTERN.test(line) && inLoop) {
      findings.push({
        filePath: input.filePath,
        line: lineNo,
        rule: "dml-in-loop",
        risk: "high",
        message: "ループ内 DML はガバナ制限に抵触します。Collection でまとめてから実行してください。",
        estimatedImpactScore: 10
      });
    }
    if (SIZE_IN_LOOP_PATTERN.test(line)) {
      findings.push({
        filePath: input.filePath,
        line: lineNo,
        rule: "size-in-loop-condition",
        risk: "low",
        message: "for 条件内の .size() 呼び出しは反復毎に評価されます。事前にローカル変数化を検討してください。",
        estimatedImpactScore: 1
      });
    }
    if (FUTURE_ANNOTATION.test(line)) {
      const next = lines[i + 1] ?? "";
      if (/\([^)]*\bsObject\b|\([^)]*\bSObject\b/.test(next)) {
        findings.push({
          filePath: input.filePath,
          line: lineNo,
          rule: "future-with-sobject",
          risk: "high",
          message: "@future メソッドの引数に sObject を渡すことはできません。Id 集合に変換してください。",
          estimatedImpactScore: 8
        });
      }
    }
    if (SCHEDULABLE_BATCH_PATTERN.test(line) && /global\s+class/i.test(line)) {
      // OK declaration; just informational tag
    }
  }

  // nested loop depth
  for (const l of loops) {
    if (l.depth >= 3) {
      findings.push({
        filePath: input.filePath,
        line: l.startLine,
        rule: "deeply-nested-loop",
        risk: "medium",
        message: `ループのネストが ${l.depth} レベルあります。計算量を見直してください。`,
        estimatedImpactScore: 4
      });
    }
  }

  // long methods
  for (const m of detectMethodLengths(lines)) {
    if (m.lengthLines >= 100) {
      findings.push({
        filePath: input.filePath,
        line: m.startLine,
        rule: "long-method",
        risk: "medium",
        message: `メソッド長 ${m.lengthLines} 行は責務分割を検討してください。`,
        estimatedImpactScore: 3
      });
    }
  }

  return findings;
}

export function predictApexPerformance(inputs: ApexPerfInput[]): ApexPerfReport {
  const findings: ApexPerfFinding[] = [];
  for (const input of inputs) {
    findings.push(...scanFile(input));
  }
  const findingsByRisk = { high: 0, medium: 0, low: 0 };
  let riskScore = 0;
  for (const f of findings) {
    findingsByRisk[f.risk] += 1;
    riskScore += RISK_WEIGHT[f.risk];
  }
  return {
    totalFiles: inputs.length,
    totalFindings: findings.length,
    riskScore,
    findingsByRisk,
    findings
  };
}

export const __testables = { findLoopBlocks, detectMethodLengths };
