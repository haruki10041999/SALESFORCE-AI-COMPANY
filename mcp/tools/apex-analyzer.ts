import fs from "node:fs";
import { SafeFilePathSchema, runSchemaValidation } from "../core/quality/resource-validation.js";

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
};

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
  const dynamicCallArgs = [...src.matchAll(/Database\.(query|countQuery)\s*\(([^)]*)\)/gi)].map((m) => m[2] ?? "");
  const hasDynamicSoqlConcat = dynamicCallArgs.some((arg) => arg.includes("+"));
  const hasStringFormatDynamicSoql = dynamicCallArgs.some((arg) => /String\.format\s*\(/i.test(arg));
  const hasEscapeSingleQuotes = /String\.escapeSingleQuotes\s*\(/i.test(src);
  const entityName = filePath.split(/[\\/]/).pop()?.replace(/\.(cls|trigger)$/i, "") ?? "unknown";
  const sourceKind = /\.trigger$/i.test(filePath) ? "trigger" : /\.cls$/i.test(filePath) ? "class" : "unknown";
  const probableTestNames = [`${entityName}Test`, `${entityName}Tests`];

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
    hasAsyncMethod: /@future\b|implements\s+Queueable|implements\s+Schedulable/i.test(src)
  };
}
