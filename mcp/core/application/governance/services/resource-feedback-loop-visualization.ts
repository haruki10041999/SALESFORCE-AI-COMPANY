import { loadProposalFeedbackLog } from "../../../resource/proposal-feedback.js";
import {
  visualizeFeedbackLoop,
  type FeedbackVisualizationResult
} from "../../../resource/feedback-loop-visualization.js";

export interface VisualizeFeedbackLoopInput {
  periodDays?: number;
  trendWindowDays?: number;
  minSamples?: number;
  topResources?: number;
  topTopics?: number;
}

export async function executeVisualizeFeedbackLoop(args: {
  proposalFeedbackLog: string;
  input: VisualizeFeedbackLoopInput;
}): Promise<{ result: FeedbackVisualizationResult; markdown: string }> {
  const entries = await loadProposalFeedbackLog(args.proposalFeedbackLog);
  const result = visualizeFeedbackLoop(entries, {
    periodDays: args.input.periodDays,
    trendWindowDays: args.input.trendWindowDays,
    minSamples: args.input.minSamples,
    topResources: args.input.topResources,
    topTopics: args.input.topTopics
  });

  const markdown = [
    `## Feedback Loop 可視化 (直近 ${result.windowDays}日)`,
    "",
    "| 指標 | 値 |",
    "|------|-----|",
    `| 総フィードバック | ${result.totals.total} |`,
    `| 採択 | ${result.totals.accepted} |`,
    `| 却下 | ${result.totals.rejected} |`,
    `| 採択率 | ${(result.totals.acceptRate * 100).toFixed(1)}% |`,
    ...(result.trends.rising.length > 0
      ? [
        "",
        "### 📈 上昇トレンド",
        ...result.trends.rising.slice(0, 5).map(
          (trend) => `- **${trend.name}** (${trend.resourceType}): ${(trend.recentAcceptRate * 100).toFixed(0)}% (+${(trend.delta * 100).toFixed(1)}%)`
        )
      ]
      : []),
    ...(result.trends.falling.length > 0
      ? [
        "",
        "### 📉 下降トレンド",
        ...result.trends.falling.slice(0, 5).map(
          (trend) => `- **${trend.name}** (${trend.resourceType}): ${(trend.recentAcceptRate * 100).toFixed(0)}% (${(trend.delta * 100).toFixed(1)}%)`
        )
      ]
      : []),
    ...(result.timeline.length > 0
      ? [
        "",
        "### タイムライン (直近5日)",
        "| 日付 | 採択 | 却下 | 採択率 |",
        "|------|------|------|--------|",
        ...result.timeline.slice(-5).map(
          (point) => `| ${point.date} | ${point.accepted} | ${point.rejected} | ${(point.acceptRate * 100).toFixed(1)}% |`
        )
      ]
      : [])
  ].join("\n");

  return {
    result,
    markdown
  };
}