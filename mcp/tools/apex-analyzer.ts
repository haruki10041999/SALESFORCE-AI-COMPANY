import fs from "node:fs";

export type ApexFileAnalysis = {
  path: string;
  hasTriggerPatternHints: boolean;
  hasSoqlInLoopRisk: boolean;
  hasDmlInLoopRisk: boolean;
  withoutSharingUsed: boolean;
  dynamicSoqlUsed: boolean;
  missingCrudFlsCheck: boolean;
  testClassDetected: boolean;
  hasAsyncMethod: boolean;
};

export function analyzeApex(filePath: string): ApexFileAnalysis {
  const src = fs.readFileSync(filePath, "utf-8");

  const hasLoop = /for\s*\(|while\s*\(/i.test(src);
  const hasInlineSoql = /\[[\s\S]*?select[\s\S]*?from[\s\S]*?\]/i.test(src);
  const hasDml = /\b(insert|update|upsert|delete|undelete)\b/i.test(src);
  const hasCrudGuard = /stripInaccessible|isAccessible\(|isUpdateable\(|isCreateable\(/i.test(src);

  return {
    path: filePath,
    hasTriggerPatternHints: /trigger\s+\w+\s+on\s+\w+/i.test(src) || /handler/i.test(src),
    hasSoqlInLoopRisk: hasLoop && hasInlineSoql,
    hasDmlInLoopRisk: hasLoop && hasDml,
    withoutSharingUsed: /\bwithout\s+sharing\b/i.test(src),
    dynamicSoqlUsed: /\bDatabase\.query\s*\(|Database\.countQuery\s*\(/i.test(src),
    missingCrudFlsCheck: hasDml && !hasCrudGuard,
    testClassDetected: /@IsTest\b/i.test(src),
    hasAsyncMethod: /@future\b|implements\s+Queueable|implements\s+Schedulable/i.test(src)
  };
}
