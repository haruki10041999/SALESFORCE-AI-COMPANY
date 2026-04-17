import { ensureGitRepoAndRefs, getDiffFiles, getFileExtension, validateRef } from "./git-diff-helpers.js";

export type PrReadinessInput = {
  repoPath: string;
  integrationBranch: string;
  workingBranch: string;
};

export type ReadinessItem = {
  id: string;
  title: string;
  status: "pass" | "warning" | "fail";
  detail: string;
};

export type PrReadinessResult = {
  comparison: string;
  score: number;
  gate: "ready" | "needs-review" | "blocked";
  changedFiles: number;
  recommendedAgents: string[];
  checklist: ReadinessItem[];
  summary: string;
};

function hasPath(files: { path: string }[], pattern: RegExp): boolean {
  return files.some((f) => pattern.test(f.path));
}

export function checkPrReadiness(input: PrReadinessInput): PrReadinessResult {
  const { repoPath, integrationBranch, workingBranch } = input;
  validateRef(integrationBranch, "integrationBranch");
  validateRef(workingBranch, "workingBranch");
  ensureGitRepoAndRefs(repoPath, [integrationBranch, workingBranch]);

  const comparison = `${integrationBranch}...${workingBranch}`;
  const files = getDiffFiles(repoPath, comparison);

  const changedFiles = files.length;
  const hasApex = hasPath(files, /\.cls$|\.trigger$/i);
  const hasLwc = hasPath(files, /\/lwc\//i);
  const hasSecurityFiles = hasPath(files, /\/permissionsets\/|\/profiles\//i);
  const hasTests = hasPath(files, /Test\.cls$|\.test\.js$/i);
  const hasDelete = files.some((f) => f.status === "D");
  const largeChange = files.filter((f) => f.additions + f.deletions >= 200).length;

  const extCount: Record<string, number> = {};
  for (const file of files) {
    const ext = getFileExtension(file.path);
    extCount[ext] = (extCount[ext] ?? 0) + 1;
  }

  const checklist: ReadinessItem[] = [
    {
      id: "tests",
      title: "テスト変更または追加",
      status: hasTests ? "pass" : "warning",
      detail: hasTests ? "テスト関連ファイルの変更あり" : "テスト変更が見当たりません"
    },
    {
      id: "deletions",
      title: "削除差分の確認",
      status: hasDelete ? "warning" : "pass",
      detail: hasDelete ? "削除差分が含まれています" : "削除差分なし"
    },
    {
      id: "size",
      title: "差分サイズ",
      status: largeChange >= 3 ? "fail" : largeChange > 0 ? "warning" : "pass",
      detail: largeChange > 0 ? `大きな変更ファイル: ${largeChange}件` : "大きな変更はありません"
    },
    {
      id: "security",
      title: "権限/セキュリティ影響",
      status: hasSecurityFiles ? "warning" : "pass",
      detail: hasSecurityFiles ? "Permission Set / Profile 変更あり" : "顕著な権限変更なし"
    }
  ];

  let score = 100;
  for (const item of checklist) {
    if (item.status === "warning") score -= 10;
    if (item.status === "fail") score -= 25;
  }
  score = Math.max(0, score);

  const gate = score >= 80 ? "ready" : score >= 60 ? "needs-review" : "blocked";

  const recommendedAgents: string[] = ["product-manager", "qa-engineer"];
  if (hasApex) recommendedAgents.push("apex-developer");
  if (hasLwc) recommendedAgents.push("lwc-developer");
  if (hasSecurityFiles) recommendedAgents.push("security-engineer");
  if (largeChange > 0) recommendedAgents.push("architect");

  const summary = [
    `比較: ${comparison}`,
    `PR準備スコア: ${score} (${gate})`,
    `変更ファイル数: ${changedFiles}`,
    `主要拡張子: ${Object.entries(extCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(", ") || "なし"}`
  ].join("\n");

  return {
    comparison,
    score,
    gate,
    changedFiles,
    recommendedAgents: [...new Set(recommendedAgents)],
    checklist,
    summary
  };
}
