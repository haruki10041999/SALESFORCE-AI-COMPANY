import { promises as fsPromises } from "node:fs";
import { join, resolve } from "node:path";
import { applyAgentOutcomes, type AgentTrustHistoriesFile } from "../core/quality/agent-trust-store.js";

type PromptMetrics = {
  estimatedTokens: number;
  containsProjectContext: boolean;
  containsAgentsSection: boolean;
  containsSkillsSection: boolean;
  containsTaskSection: boolean;
  skillCoverageRate: number;
  triggerMatchRate: number;
};

type RunChatTool = (input: {
  topic: string;
  filePaths?: string[];
  agents?: string[];
  persona?: string;
  skills?: string[];
  turns?: number;
  maxContextChars?: number;
  appendInstruction?: string;
}) => Promise<{ content: Array<{ type: string; text: string }> }>;

type EvaluatePromptMetrics = (prompt: string, skills?: string[], triggerKeywords?: string[]) => PromptMetrics;

export type AgentAbTestInput = {
  topic: string;
  agentA: string;
  agentB: string;
  filePaths?: string[];
  persona?: string;
  skills?: string[];
  turns?: number;
  maxContextChars?: number;
  appendInstruction?: string;
  reportOutputDir?: string;
  applyOutcomeToTrustStore?: boolean;
  trustStoreFilePath?: string;
};

export type AgentAbRunResult = {
  agent: string;
  durationMs: number;
  promptChars: number;
  promptExcerpt: string;
  metrics: PromptMetrics;
  qualityScore: number;
};

export type AgentAbTestResult = {
  generatedAt: string;
  topic: string;
  comparison: string;
  winner: {
    byQuality: string;
    byLatency: string;
    overall: string;
  };
  runs: {
    agentA: AgentAbRunResult;
    agentB: AgentAbRunResult;
  };
  reportJsonPath: string;
  reportMarkdownPath: string;
  summary: string;
  trustStoreApplied?: {
    filePath: string;
    winnerAgent: string;
    loserAgent: string;
    histories: AgentTrustHistoriesFile["histories"];
  };
};

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

function computeQualityScore(metrics: PromptMetrics): number {
  let score = 0;
  score += metrics.containsProjectContext ? 12 : 0;
  score += metrics.containsAgentsSection ? 10 : 0;
  score += metrics.containsSkillsSection ? 10 : 0;
  score += metrics.containsTaskSection ? 12 : 0;
  score += Math.round(metrics.skillCoverageRate * 36);
  score += Math.round(metrics.triggerMatchRate * 10);
  score += Math.round(Math.max(0, 10 - Math.max(0, metrics.estimatedTokens - 4000) / 500));
  return Math.max(0, Math.min(100, score));
}

async function runSingle(
  runChatTool: RunChatTool,
  evaluatePromptMetrics: EvaluatePromptMetrics,
  input: AgentAbTestInput,
  agent: string
): Promise<AgentAbRunResult> {
  const started = Date.now();
  const runResult = await runChatTool({
    topic: input.topic,
    filePaths: input.filePaths,
    agents: [agent],
    persona: input.persona,
    skills: input.skills,
    turns: input.turns,
    maxContextChars: input.maxContextChars,
    appendInstruction: input.appendInstruction
  });
  const durationMs = Date.now() - started;
  const prompt = runResult.content.map((item) => item.text).join("\n\n");
  const metrics = evaluatePromptMetrics(prompt, input.skills ?? [], [input.topic, agent]);
  const qualityScore = computeQualityScore(metrics);

  return {
    agent,
    durationMs,
    promptChars: prompt.length,
    promptExcerpt: clipText(prompt, 1200),
    metrics,
    qualityScore
  };
}

function buildMarkdown(result: AgentAbTestResult): string {
  const lines: string[] = [];
  lines.push("# Agent A/B Comparison Report");
  lines.push("");
  lines.push(`- generatedAt: ${result.generatedAt}`);
  lines.push(`- topic: ${result.topic}`);
  lines.push(`- comparison: ${result.comparison}`);
  lines.push(`- winner(byQuality): ${result.winner.byQuality}`);
  lines.push(`- winner(byLatency): ${result.winner.byLatency}`);
  lines.push(`- winner(overall): ${result.winner.overall}`);
  lines.push("");
  lines.push("## Scores");
  lines.push("");
  lines.push("| agent | qualityScore | durationMs | promptChars | estimatedTokens | skillCoverageRate |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  lines.push(
    `| ${result.runs.agentA.agent} | ${result.runs.agentA.qualityScore} | ${result.runs.agentA.durationMs} | ${result.runs.agentA.promptChars} | ${result.runs.agentA.metrics.estimatedTokens} | ${(result.runs.agentA.metrics.skillCoverageRate * 100).toFixed(1)}% |`
  );
  lines.push(
    `| ${result.runs.agentB.agent} | ${result.runs.agentB.qualityScore} | ${result.runs.agentB.durationMs} | ${result.runs.agentB.promptChars} | ${result.runs.agentB.metrics.estimatedTokens} | ${(result.runs.agentB.metrics.skillCoverageRate * 100).toFixed(1)}% |`
  );
  return lines.join("\n");
}

export async function runAgentAbTest(
  input: AgentAbTestInput,
  deps: {
    runChatTool: RunChatTool;
    evaluatePromptMetrics: EvaluatePromptMetrics;
    outputsDir: string;
  }
): Promise<AgentAbTestResult> {
  // 保存方針 (集約型):
  //   <reportDir>/runs.jsonl    ← 全実行を 1 行 = 1 結果で append (履歴永続)
  //   <reportDir>/latest.json   ← 直近 1 件 (上書き)
  //   <reportDir>/latest.md     ← 直近 1 件 (上書き)
  // 旧来の `agent-ab-test-<stamp>.{json,md}` 形式は廃止。
  const reportDir = input.reportOutputDir
    ? resolve(input.reportOutputDir)
    : join(resolve(deps.outputsDir), "reports", "agent-ab-test");

  const [agentA, agentB] = await Promise.all([
    runSingle(deps.runChatTool, deps.evaluatePromptMetrics, input, input.agentA),
    runSingle(deps.runChatTool, deps.evaluatePromptMetrics, input, input.agentB)
  ]);

  const byQuality = agentA.qualityScore >= agentB.qualityScore ? agentA.agent : agentB.agent;
  const byLatency = agentA.durationMs <= agentB.durationMs ? agentA.agent : agentB.agent;
  const overall = byQuality === byLatency ? byQuality : byQuality;
  const generatedAt = new Date().toISOString();

  await fsPromises.mkdir(reportDir, { recursive: true });
  const runsJsonlPath = join(reportDir, "runs.jsonl");
  const reportJsonPath = join(reportDir, "latest.json");
  const reportMarkdownPath = join(reportDir, "latest.md");

  const result: AgentAbTestResult = {
    generatedAt,
    topic: input.topic,
    comparison: `${input.agentA} vs ${input.agentB}`,
    winner: {
      byQuality,
      byLatency,
      overall
    },
    runs: {
      agentA,
      agentB
    },
    reportJsonPath,
    reportMarkdownPath,
    summary: [
      `comparison: ${input.agentA} vs ${input.agentB}`,
      `winner: ${overall}`,
      `quality: ${agentA.agent}=${agentA.qualityScore}, ${agentB.agent}=${agentB.qualityScore}`,
      `latencyMs: ${agentA.agent}=${agentA.durationMs}, ${agentB.agent}=${agentB.durationMs}`
    ].join("\n")
  };

  // append 1 行 (履歴) → latest を上書き
  await fsPromises.appendFile(runsJsonlPath, `${JSON.stringify(result)}\n`, "utf-8");
  await fsPromises.writeFile(reportJsonPath, JSON.stringify(result, null, 2), "utf-8");
  await fsPromises.writeFile(reportMarkdownPath, buildMarkdown(result), "utf-8");

  if (input.applyOutcomeToTrustStore && overall && agentA.agent !== agentB.agent) {
    const trustStorePath = input.trustStoreFilePath
      ? resolve(input.trustStoreFilePath)
      : join(resolve(deps.outputsDir), "agent-trust-histories.json");
    const loserAgent = overall === agentA.agent ? agentB.agent : agentA.agent;
    const updated = await applyAgentOutcomes(trustStorePath, [
      { agent: overall, outcome: "accepted" },
      { agent: loserAgent, outcome: "rejected" }
    ]);
    result.trustStoreApplied = {
      filePath: trustStorePath,
      winnerAgent: overall,
      loserAgent,
      histories: updated.histories
    };
  }

  return result;
}

/**
 * TASK-031 仕様準拠の API 名エイリアス。
 * winner / loser を直接指定して trust store に outcome を反映する。
 *
 * @param trustStorePath - 永続化先 JSON
 * @param winner - 採用された agent 名
 * @param loser - 採用されなかった agent 名
 * @param magnitude - 反映の重み (現状未使用、将来の調整用)
 */
export async function applyAbTestOutcome(
  trustStorePath: string,
  winner: string,
  loser: string,
  _magnitude: number = 1
): Promise<{ histories: AgentTrustHistoriesFile["histories"] }> {
  if (!winner || !loser || winner === loser) {
    throw new Error("winner and loser must be distinct non-empty strings");
  }
  const updated = await applyAgentOutcomes(trustStorePath, [
    { agent: winner, outcome: "accepted" },
    { agent: loser, outcome: "rejected" }
  ]);
  return { histories: updated.histories };
}