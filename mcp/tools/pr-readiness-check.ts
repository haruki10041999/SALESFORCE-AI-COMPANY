import { ensureGitRepoAndRefs, getDiffFiles, getFileExtension, validateRef } from "./git-diff-helpers.js";

export type PrReadinessInput = {
  repoPath: string;
  baseBranch?: string;
  integrationBranch?: string;
  workingBranch: string;
  reviewText?: string;
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
  baseGate: "ready" | "needs-review" | "blocked";
  changedFiles: number;
  recommendedAgents: string[];
  checklist: ReadinessItem[];
  reviewSignal: {
    decision: "ready" | "needs-review" | "blocked";
    matchedKeywords: string[];
  } | null;
  summary: string;
};

const REVIEW_KEYWORDS = {
  ready: [
    "lgtm",
    "approved",
    "approve",
    "ship it",
    "looks good",
    "問題なし",
    "承認",
    "ok to merge",
    "aprobado",
    "approuve",
    "genehmigt",
    "批准",
    "승인"
  ],
  needsReview: [
    "needs review",
    "review needed",
    "nit",
    "suggestion",
    "please check",
    "要確認",
    "確認お願いします",
    "再レビュー",
    "要再確認",
    "請確認",
    "revisar",
    "a verifier",
    "bitte prüfen",
    "검토 필요"
  ],
  blocked: [
    "request changes",
    "changes requested",
    "must fix",
    "blocking",
    "do not merge",
    "fail",
    "要修正",
    "差し戻し",
    "マージ不可",
    "修正必須",
    "必须修复",
    "不能合并",
    "debe corregirse",
    "bloquant",
    "blockiert",
    "수정 필요"
  ]
} as const;

function mergeGate(
  baseGate: "ready" | "needs-review" | "blocked",
  reviewGate: "ready" | "needs-review" | "blocked" | null
): "ready" | "needs-review" | "blocked" {
  if (!reviewGate) return baseGate;
  const rank = {
    ready: 0,
    "needs-review": 1,
    blocked: 2
  } as const;
  return rank[reviewGate] > rank[baseGate] ? reviewGate : baseGate;
}

function evaluateReviewSignal(reviewText: string | undefined): {
  decision: "ready" | "needs-review" | "blocked";
  matchedKeywords: string[];
} | null {
  if (!reviewText || reviewText.trim().length === 0) {
    return null;
  }

  const normalized = reviewText.toLowerCase();
  const blockedKeywords = REVIEW_KEYWORDS.blocked.filter((kw) => normalized.includes(kw));
  if (blockedKeywords.length > 0) {
    return {
      decision: "blocked",
      matchedKeywords: blockedKeywords
    };
  }

  const needsReviewKeywords = REVIEW_KEYWORDS.needsReview.filter((kw) => normalized.includes(kw));
  if (needsReviewKeywords.length > 0) {
    return {
      decision: "needs-review",
      matchedKeywords: needsReviewKeywords
    };
  }

  const readyKeywords = REVIEW_KEYWORDS.ready.filter((kw) => normalized.includes(kw));
  if (readyKeywords.length > 0) {
    return {
      decision: "ready",
      matchedKeywords: readyKeywords
    };
  }

  return null;
}

function hasPath(files: { path: string }[], pattern: RegExp): boolean {
  return files.some((f) => pattern.test(f.path));
}

export function checkPrReadiness(input: PrReadinessInput): PrReadinessResult {
  const { repoPath, workingBranch, reviewText } = input;
  const baseBranch = input.baseBranch ?? input.integrationBranch;
  if (!baseBranch) {
    throw new Error("baseBranch is required");
  }
  validateRef(baseBranch, "baseBranch");
  validateRef(workingBranch, "workingBranch");
  ensureGitRepoAndRefs(repoPath, [baseBranch, workingBranch]);

  const comparison = `${baseBranch}...${workingBranch}`;
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

  const baseGate = score >= 80 ? "ready" : score >= 60 ? "needs-review" : "blocked";
  const reviewSignal = evaluateReviewSignal(reviewText);
  const gate = mergeGate(baseGate, reviewSignal?.decision ?? null);

  const recommendedAgents: string[] = ["product-manager", "qa-engineer"];
  if (hasApex) recommendedAgents.push("apex-developer");
  if (hasLwc) recommendedAgents.push("lwc-developer");
  if (hasSecurityFiles) recommendedAgents.push("security-engineer");
  if (largeChange > 0) recommendedAgents.push("architect");

  const summary = [
    `比較: ${comparison}`,
    `PR準備スコア: ${score} (${baseGate})`,
    reviewSignal
      ? `レビュー判定: ${reviewSignal.decision} (keywords: ${reviewSignal.matchedKeywords.join(", ")})`
      : "レビュー判定: なし",
    `最終ゲート: ${gate}`,
    `変更ファイル数: ${changedFiles}`,
    `主要拡張子: ${Object.entries(extCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(", ") || "なし"}`
  ].join("\n");

  return {
    comparison,
    score,
    gate,
    baseGate,
    changedFiles,
    recommendedAgents: [...new Set(recommendedAgents)],
    checklist,
    reviewSignal,
    summary
  };
}
