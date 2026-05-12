import { recordUserFeedback } from "../../../learning/feedback-manager.js";

export interface RateToolExecutionInput {
  toolName: string;
  stars: number;
  sessionId?: string;
  comment?: string;
  tags?: string[];
  starToRating: (stars: number) => "thumbs-up" | "thumbs-down" | "neutral";
  policySnapshotManager?: { scheduleRefresh(): void; notifyPolicyUpdated(): Promise<void> };
}

export interface RecordUserFeedbackInput {
  sessionId: string;
  rating: "thumbs-up" | "thumbs-down" | "neutral";
  agentName?: string;
  comment?: string;
  qualityScore?: number;
  tags?: string[];
  policySnapshotManager?: { scheduleRefresh(): void; notifyPolicyUpdated(): Promise<void> };
}

export interface GetFeedbackMetricsInput {
  sessionId?: string;
  computeFeedbackMetrics: (sessionId?: string) => Promise<{
    totalFeedback: number;
    thumbsUpCount: number;
    thumbsUpRate: number;
    thumbsDownCount: number;
    neutralCount: number;
    averageQualityScore?: number | null;
    mostCommonTags?: Array<{ tag: string; count: number }>;
  }>;
}

export interface GetSessionFeedbackInput {
  sessionId: string;
  loadFeedbackForSession: (sessionId: string) => Promise<unknown[]>;
}

export async function executeRateToolExecution(input: RateToolExecutionInput): Promise<Record<string, unknown>> {
  const {
    toolName,
    stars,
    sessionId,
    comment,
    tags,
    starToRating,
    policySnapshotManager
  } = input;

  const feedback = await recordUserFeedback({
    sessionId: sessionId ?? `tool:${toolName}`,
    agentName: toolName,
    rating: starToRating(stars),
    comment,
    qualityScore: Number(((stars - 1) / 4).toFixed(2)),
    tags: ["tool-execution", `stars:${stars}`, ...(tags ?? [])]
  });

  // T-07: trigger online policy refresh after feedback
  if (policySnapshotManager) {
    policySnapshotManager.scheduleRefresh();
    void policySnapshotManager.notifyPolicyUpdated();
  }

  return {
    success: true,
    feedbackId: feedback.feedbackId,
    toolName,
    stars,
    normalizedRating: feedback.rating,
    qualityScore: feedback.qualityScore,
    timestamp: feedback.timestamp
  };
}

export async function executeRecordUserFeedback(input: RecordUserFeedbackInput): Promise<Record<string, unknown>> {
  const { policySnapshotManager, ...feedbackInput } = input;

  const feedback = await recordUserFeedback(feedbackInput);

  // T-07: trigger online policy refresh after feedback
  if (policySnapshotManager) {
    policySnapshotManager.scheduleRefresh();
    void policySnapshotManager.notifyPolicyUpdated();
  }

  return {
    success: true,
    feedbackId: feedback.feedbackId,
    timestamp: feedback.timestamp
  };
}

export async function executeGetFeedbackMetrics(input: GetFeedbackMetricsInput): Promise<{
  metrics: Record<string, unknown>;
  markdown: string;
}> {
  const metrics = await input.computeFeedbackMetrics(input.sessionId);
  const markdown = [
    "## フィードバックメトリクス",
    "",
    "| 指標 | 値 |",
    "|------|-----|",
    `| 総フィードバック数 | ${metrics.totalFeedback} |`,
    `| 👍 高評価 | ${metrics.thumbsUpCount} (${(metrics.thumbsUpRate * 100).toFixed(1)}%) |`,
    `| 👎 低評価 | ${metrics.thumbsDownCount} |`,
    `| 中立 | ${metrics.neutralCount} |`,
    ...(metrics.averageQualityScore != null
      ? [`| 平均品質スコア | ${metrics.averageQualityScore.toFixed(2)} |`]
      : []),
    ...(metrics.mostCommonTags && metrics.mostCommonTags.length > 0
      ? ["", "### タグ別件数", ...metrics.mostCommonTags.slice(0, 10).map((t) => `- **${t.tag}**: ${t.count}件`)]
      : [])
  ].join("\n");

  return {
    metrics,
    markdown
  };
}

export async function executeGetSessionFeedback(input: GetSessionFeedbackInput): Promise<Record<string, unknown>> {
  const feedback = await input.loadFeedbackForSession(input.sessionId);
  return {
    sessionId: input.sessionId,
    feedbackCount: feedback.length,
    records: feedback
  };
}
