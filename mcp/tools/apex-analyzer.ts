import fs from "node:fs";
import { SafeFilePathSchema, runSchemaValidation } from "../core/quality/resource-validation.js";
import { analyzeApexSource, type ApexAnalysis } from "../core/parsers/apex-ast.js";

export type ApexFileAnalysis = {
  path: string;
  entityName: string;
  sourceKind: "class" | "trigger" | "unknown";
  probableTestNames: string[];
  hasTriggerPatternHints: boolean;
  hasSoqlInLoopRisk: boolean;
  hasDmlInLoopRisk: boolean;
  withoutSharingUsed: boolean;
  dynamicSoqlUsed: boolean;
  hasSoqlInjectionRisk: boolean;
  missingCrudFlsCheck: boolean;
  testClassDetected: boolean;
  hasAsyncMethod: boolean;
  /** F-08: AST 解析結果 (パース成功時のみ詳細を含む) */
  ast?: ApexAnalysis;
};

/**
 * TASK-F1: extract argument fragments from `Database.query(...)` /
 * `Database.countQuery(...)` calls. The previous implementation used the
 * regex `/Database\.(query|countQuery)\s*\(([^)]*)\)/gi`, which truncates
 * arguments at the first `)` and therefore misses calls whose arguments
 * contain nested parentheses (e.g. `String.format(template, params)`),
 * multi-line concatenations, or string literals containing `)`.
 *
 * The walker below scans the source character-by-character, tracks brace /
 * bracket / parenthesis depth, and skips characters that live inside string
 * literals so that a `)` embedded in an Apex string does not close the call.
 */
function extractDynamicQueryArguments(src: string): string[] {
  const args: string[] = [];
  const headRegex = /Database\.(query|countQuery)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = headRegex.exec(src)) !== null) {
    const start = headRegex.lastIndex; // position right after the `(`
    let depth = 1;
    let i = start;
    let stringQuote: "'" | "\"" | null = null;
    while (i < src.length) {
      const ch = src[i];
      if (stringQuote) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === stringQuote) stringQuote = null;
        i += 1;
        continue;
      }
      if (ch === "'" || ch === "\"") {
        stringQuote = ch;
      } else if (ch === "(" || ch === "[" || ch === "{") {
        depth += 1;
      } else if (ch === ")" || ch === "]" || ch === "}") {
        depth -= 1;
        if (depth === 0) {
          args.push(src.slice(start, i));
          break;
        }
      }
      i += 1;
    }
  }
  return args;
}

export function analyzeApex(filePath: string): ApexFileAnalysis {
  const pathCheck = runSchemaValidation(SafeFilePathSchema, filePath);
  if (!pathCheck.success) {
    throw new Error(`Invalid filePath: ${pathCheck.errors.join(", ")}`);
  }

  const src = fs.readFileSync(filePath, "utf-8");

  const hasLoop = /for\s*\(|while\s*\(/i.test(src);
  const hasInlineSoql = /\[[\s\S]*?select[\s\S]*?from[\s\S]*?\]/i.test(src);
  const hasDml = /\b(insert|update|upsert|delete|undelete)\b/i.test(src);
  const hasCrudGuard = /stripInaccessible|isAccessible\(|isUpdateable\(|isCreateable\(/i.test(src);
  const hasDynamicSoql = /\bDatabase\.query\s*\(|Database\.countQuery\s*\(/i.test(src);
  const dynamicCallArgs = extractDynamicQueryArguments(src);
  const hasDynamicSoqlConcat = dynamicCallArgs.some((arg) => arg.includes("+"));
  const hasStringFormatDynamicSoql = dynamicCallArgs.some((arg) => /String\.format\s*\(/i.test(arg));
  const hasEscapeSingleQuotes = /String\.escapeSingleQuotes\s*\(/i.test(src);
  const entityName = filePath.split(/[\\/]/).pop()?.replace(/\.(cls|trigger)$/i, "") ?? "unknown";
  const sourceKind = /\.trigger$/i.test(filePath) ? "trigger" : /\.cls$/i.test(filePath) ? "class" : "unknown";
  const probableTestNames = [`${entityName}Test`, `${entityName}Tests`];

  // F-08: AST 解析を補助情報として付与 (失敗しても heuristic を維持)
  let astResult: ApexAnalysis | undefined;
  try {
    const ast = analyzeApexSource(src);
    if (ast.units.length > 0) astResult = ast;
  } catch {
    // AST 失敗時は heuristic のみで継続
  }

  return {
    path: filePath,
    entityName,
    sourceKind,
    probableTestNames,
    hasTriggerPatternHints: /trigger\s+\w+\s+on\s+\w+/i.test(src) || /handler/i.test(src),
    hasSoqlInLoopRisk: hasLoop && hasInlineSoql,
    hasDmlInLoopRisk: hasLoop && hasDml,
    withoutSharingUsed: /\bwithout\s+sharing\b/i.test(src),
    dynamicSoqlUsed: hasDynamicSoql,
    hasSoqlInjectionRisk: (hasDynamicSoqlConcat || hasStringFormatDynamicSoql) && !hasEscapeSingleQuotes,
    missingCrudFlsCheck: hasDml && !hasCrudGuard,
    testClassDetected: /@IsTest\b/i.test(src),
    hasAsyncMethod: /@future\b|implements\s+Queueable|implements\s+Schedulable/i.test(src),
    ...(astResult ? { ast: astResult } : {})
  };
}

// Exported for unit tests (TASK-F1).
export const __testables = { extractDynamicQueryArguments };
