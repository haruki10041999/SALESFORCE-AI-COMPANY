/**
 * T-09: Eval Harness – Agent Selection eval cases
 *
 * topic-skill-ranking の scoreByQuery を使い、
 * topic に対して適切な agent がスコア上位に来るかを検証する。
 */

import type { EvalCase } from "../../mcp/core/learning/eval-harness.js";
import { scoreByQuery } from "../../mcp/core/resource/topic-skill-ranking.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetPath = resolve(__dirname, "datasets/agent-selection.json");

interface AgentSelectionCase {
  name: string;
  topic: string;
  expectedAgents: string[];
  mustNotSelect: string[];
}

const dataset: AgentSelectionCase[] = JSON.parse(readFileSync(datasetPath, "utf-8")) as AgentSelectionCase[];

export const agentSelectionEvals: EvalCase[] = dataset.map((item) => ({
  name: item.name,
  group: "agent-selection",
  run: async () => {
    const allAgents = [
      "apex-developer",
      "lwc-developer",
      "flow-specialist",
      "data-modeler",
      "security-engineer",
      "performance-engineer",
      "refactor-specialist",
      "architect",
      "devops-engineer",
      "qa-engineer",
      "integration-developer"
    ];

    // topic との親和性スコアでソート
    const scored = allAgents
      .map((agent) => ({ agent, score: scoreByQuery(item.topic, agent) }))
      .sort((a, b) => b.score - a.score);

    return {
      topic: item.topic,
      ranked: scored,
      topAgent: scored[0]?.agent ?? null
    };
  },
  rubric: {
    scorer: (output) => {
      const result = output as { ranked: Array<{ agent: string; score: number }>; topAgent: string | null };
      const topAgents = result.ranked.slice(0, 3).map((r) => r.agent);

      if (item.mustNotSelect.length > 0) {
        // top-1 に mustNotSelect が入っている場合は 0
        if (item.mustNotSelect.includes(result.topAgent ?? "")) {
          return 0;
        }
      }

      if (item.expectedAgents.length === 0) {
        // expectedAgents 未指定 → 実行できたことを 1 とする
        return 1;
      }

      // expectedAgents のうち top-3 に含まれる割合
      const hitCount = item.expectedAgents.filter((ea) => topAgents.includes(ea)).length;
      return hitCount / item.expectedAgents.length;
    },
    minScore: 0.5
  }
}));
