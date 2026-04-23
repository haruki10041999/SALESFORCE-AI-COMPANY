import fs from "node:fs";

export type FlowFileAnalysis = {
  path: string;
  decisionCount: number;
  screenCount: number;
  recordCreateCount: number;
  recordUpdateCount: number;
  recordDeleteCount: number;
  subflowCount: number;
  hasApexAction: boolean;
  hasScheduledPath: boolean;
  riskHints: string[];
};

function countTag(source: string, tagName: string): number {
  const match = source.match(new RegExp(`<${tagName}(\\s|>)`, "g"));
  return match?.length ?? 0;
}

export function analyzeFlow(filePath: string): FlowFileAnalysis {
  const src = fs.readFileSync(filePath, "utf-8");

  const decisionCount = countTag(src, "decisions");
  const screenCount = countTag(src, "screens");
  const recordCreateCount = countTag(src, "recordCreates");
  const recordUpdateCount = countTag(src, "recordUpdates");
  const recordDeleteCount = countTag(src, "recordDeletes");
  const subflowCount = countTag(src, "subflows");
  const hasApexAction = /<actionType>apex<\/actionType>|<apexClass>/i.test(src);
  const hasScheduledPath = /<scheduledPaths>|<triggerType>Scheduled/i.test(src);

  const riskHints: string[] = [];
  if (recordCreateCount + recordUpdateCount + recordDeleteCount >= 5) {
    riskHints.push("DML相当処理が多いため、ガバナ制限と再入防止を確認してください。");
  }
  if (subflowCount >= 3) {
    riskHints.push("Subflow数が多く、実行経路の追跡が複雑です。");
  }
  if (hasApexAction) {
    riskHints.push("Apexアクションを含むため、例外伝播とトランザクション境界を確認してください。");
  }
  if (hasScheduledPath) {
    riskHints.push("Scheduled path を含むため、重複実行と遅延実行時の整合性を確認してください。");
  }

  return {
    path: filePath,
    decisionCount,
    screenCount,
    recordCreateCount,
    recordUpdateCount,
    recordDeleteCount,
    subflowCount,
    hasApexAction,
    hasScheduledPath,
    riskHints
  };
}
