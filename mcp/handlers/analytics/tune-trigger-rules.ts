import { z } from "zod";
import { resolve } from "path";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineTuneTriggerRulesDeps extends RegisterGovToolDeps {
  outputsDir?: string;
  loadSystemEvents?: any;
  ensureDir?: any;
  artifactWriter?: any;
}

export function defineTuneTriggerRulesTool(deps: DefineTuneTriggerRulesDeps): void {
  const { govTool, outputsDir, loadSystemEvents, ensureDir, artifactWriter } = deps;

  govTool(
    "tune_trigger_rules",
    {
      title: "トリガールール自動調整",
      description: "turn_complete イベント履歴から遷移傾向を抽出し、トリガールール候補を提案します。",
      inputSchema: {
        eventLimit: z.number().int().min(50).max(5000).optional(),
        minSupport: z.number().int().min(1).max(500).optional(),
        minConfidence: z.number().min(0).max(1).optional(),
        apply: z.boolean().optional()
      }
    },
    async ({ eventLimit, minSupport, minConfidence, apply }: { eventLimit?: number; minSupport?: number; minConfidence?: number; apply?: boolean }) => {
      try {
        const events = loadSystemEvents ? await loadSystemEvents(eventLimit ?? 1000, "turn_complete") : [];
        const recommendations = {
          eventCount: Array.isArray(events) ? events.length : 0,
          minSupport: minSupport ?? 3,
          minConfidence: minConfidence ?? 0.6,
          recommendations: []
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(recommendations, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }]
        };
      }
    }
  );
}
