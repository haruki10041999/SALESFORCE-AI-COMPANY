import { summarizeBranchDiff } from "./branch-diff-summary.js";

export type BranchDiffToPromptInput = {
  repoPath: string;
  integrationBranch: string;
  workingBranch: string;
  topic?: string;
  turns?: number;
  maxHighlights?: number;
};

export type BranchDiffToPromptResult = {
  prompt: string;
  recommendedAgents: string[];
  summary: string;
};

function recommendAgents(paths: string[]): string[] {
  const agents = ["product-manager", "qa-engineer"];

  if (paths.some((p) => /\.cls$|\.trigger$/i.test(p))) {
    agents.push("apex-developer");
  }
  if (paths.some((p) => /\/lwc\//i.test(p))) {
    agents.push("lwc-developer");
  }
  if (paths.some((p) => /\/permissionsets\/|\/profiles\//i.test(p))) {
    agents.push("security-engineer");
  }
  if (paths.some((p) => /\.yml$|\.yaml$|\.sh$|Dockerfile|\.github\//i.test(p))) {
    agents.push("devops-engineer");
  }
  if (paths.some((p) => /\.object-meta\.xml$|\.field-meta\.xml$/i.test(p))) {
    agents.push("data-modeler");
  }
  if (paths.length >= 10) {
    agents.push("architect");
  }

  return [...new Set(agents)];
}

export function buildBranchDiffPrompt(input: BranchDiffToPromptInput): BranchDiffToPromptResult {
  const {
    repoPath,
    integrationBranch,
    workingBranch,
    topic = "ブランチ差分レビュー",
    turns = 6,
    maxHighlights = 8
  } = input;

  const diff = summarizeBranchDiff({
    repoPath,
    integrationBranch,
    workingBranch,
    maxFiles: Math.max(1, maxHighlights)
  });

  const top = diff.fileChanges.slice(0, Math.max(1, maxHighlights));
  const lines = top.map((f) => {
    const symbols = f.touchedSymbols.length > 0 ? ` / 箇所: ${f.touchedSymbols.slice(0, 2).join(" | ")}` : "";
    return `- ${f.path} [${f.status}] (+${f.additions}/-${f.deletions})${symbols}`;
  });

  const agents = recommendAgents(top.map((f) => f.path));

  const prompt = [
    `トピック: ${topic}`,
    `比較対象: ${diff.comparison}`,
    `推奨ターン数: ${turns}`,
    "",
    "## 主要差分",
    ...lines,
    "",
    "## 指示",
    `以下のエージェントで差分レビュー会話を行ってください: ${agents.join(", ")}`,
    "各発言は **エージェント名**: 発言内容 の形式にしてください。",
    "重大なリスク、追加テスト、デプロイ注意点を必ず含めてください。"
  ].join("\n");

  return {
    prompt,
    recommendedAgents: agents,
    summary: diff.summary
  };
}
