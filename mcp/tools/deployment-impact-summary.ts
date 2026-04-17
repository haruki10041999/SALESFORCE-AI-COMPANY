import { ensureGitRepoAndRefs, getDiffFiles, validateRef } from "./git-diff-helpers.js";

export type DeploymentImpactInput = {
  repoPath: string;
  integrationBranch: string;
  workingBranch: string;
};

export type DeploymentImpactResult = {
  comparison: string;
  metadataBreakdown: Record<string, number>;
  additions: number;
  modifications: number;
  deletions: number;
  cautions: string[];
  summary: string;
};

function metadataType(path: string): string {
  if (/\/classes\/.*\.cls$/i.test(path)) return "ApexClass";
  if (/\/triggers\/.*\.trigger$/i.test(path)) return "ApexTrigger";
  if (/\/lwc\//i.test(path)) return "LWC";
  if (/\.object-meta\.xml$/i.test(path)) return "CustomObject";
  if (/\/fields\/.*\.field-meta\.xml$/i.test(path)) return "CustomField";
  if (/\/permissionsets\//i.test(path)) return "PermissionSet";
  if (/\/profiles\//i.test(path)) return "Profile";
  if (/\/flows\//i.test(path)) return "Flow";
  if (/\/layouts\//i.test(path)) return "Layout";
  return "Other";
}

export function summarizeDeploymentImpact(input: DeploymentImpactInput): DeploymentImpactResult {
  const { repoPath, integrationBranch, workingBranch } = input;
  validateRef(integrationBranch, "integrationBranch");
  validateRef(workingBranch, "workingBranch");
  ensureGitRepoAndRefs(repoPath, [integrationBranch, workingBranch]);

  const comparison = `${integrationBranch}...${workingBranch}`;
  const files = getDiffFiles(repoPath, comparison);

  const metadataBreakdown: Record<string, number> = {};
  let additions = 0;
  let modifications = 0;
  let deletions = 0;

  for (const file of files) {
    const kind = metadataType(file.path);
    metadataBreakdown[kind] = (metadataBreakdown[kind] ?? 0) + 1;

    if (file.status === "A") additions += 1;
    else if (file.status === "D") deletions += 1;
    else modifications += 1;
  }

  const cautions: string[] = [];
  if ((metadataBreakdown.PermissionSet ?? 0) + (metadataBreakdown.Profile ?? 0) > 0) {
    cautions.push("権限関連メタデータ変更があるため、ユーザー権限の回帰確認が必要です。");
  }
  if ((metadataBreakdown.Flow ?? 0) > 0) {
    cautions.push("Flow変更が含まれるため、起動条件と既存自動化の競合確認が必要です。");
  }
  if ((metadataBreakdown.ApexTrigger ?? 0) > 0) {
    cautions.push("Trigger変更が含まれるため、バルク実行と再帰防止の確認が必要です。");
  }
  if (deletions > 0) {
    cautions.push("削除差分があるため、依存先メタデータとロールバック手順を確認してください。");
  }

  const topTypes = Object.entries(metadataBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");

  const summary = [
    `比較: ${comparison}`,
    `差分件数: ${files.length} (追加 ${additions} / 変更 ${modifications} / 削除 ${deletions})`,
    `主要メタデータ: ${topTypes || "なし"}`,
    `注意点: ${cautions.length}`
  ].join("\n");

  return {
    comparison,
    metadataBreakdown,
    additions,
    modifications,
    deletions,
    cautions,
    summary
  };
}
