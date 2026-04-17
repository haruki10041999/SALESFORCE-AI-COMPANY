import fs from "node:fs";

export type ApexFileAnalysis = {
  path: string;
  hasTriggerPatternHints: boolean;
  hasSoqlInLoopRisk: boolean;
};

export function analyzeApex(filePath: string): ApexFileAnalysis {
  const src = fs.readFileSync(filePath, "utf-8");
  const hasTriggerPatternHints = /trigger\s+\w+\s+on\s+\w+/i.test(src) || /handler/i.test(src);

  const hasLoop = /for\s*\([^)]*\)\s*\{[\s\S]*?\}/m.test(src);
  const hasInlineSoql = /\[[\s\S]*?select[\s\S]*?from[\s\S]*?\]/i.test(src);
  const hasSoqlInLoopRisk = hasLoop && hasInlineSoql;

  return {
    path: filePath,
    hasTriggerPatternHints,
    hasSoqlInLoopRisk
  };
}
