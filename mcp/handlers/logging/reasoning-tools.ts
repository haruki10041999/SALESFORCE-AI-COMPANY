import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";
import {
  appendTraceReasoningStep,
  getTraceReasoningSteps,
  renderTraceReasoningMarkdown,
  renderTraceReasoningMermaid
} from "../../core/trace/trace-context.js";

export interface DefineReasoningToolsDeps extends RegisterGovToolDeps {}

export function defineReasoningTools(deps: DefineReasoningToolsDeps): void {
  const { govTool } = deps;

  govTool(
    "record_reasoning_step",
    {
      title: "推論ステップ記録",
      description: "Think/Do/Check の推論ステップを trace に記録します。",
      inputSchema: {
        traceId: z.string(),
        stage: z.enum(["think", "do", "check"]),
        message: z.string(),
        agent: z.string().optional(),
        details: z.string().optional()
      }
    },
    async ({ traceId, stage, message, agent, details }: {
      traceId: string;
      stage: "think" | "do" | "check";
      message: string;
      agent?: string;
      details?: string;
    }) => {
      const steps = appendTraceReasoningStep(traceId, {
        stage,
        message,
        agent,
        details
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                recorded: true,
                traceId,
                stepCount: steps.length,
                latest: steps[steps.length - 1]
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "get_trace_reasoning",
    {
      title: "推論チェーン可視化",
      description: "trace の推論ステップを JSON/Markdown/Mermaid で取得します。",
      inputSchema: {
        traceId: z.string(),
        format: z.enum(["json", "markdown", "mermaid", "all"]).optional()
      }
    },
    async ({ traceId, format }: { traceId: string; format?: "json" | "markdown" | "mermaid" | "all" }) => {
      const selected = format ?? "all";
      const steps = getTraceReasoningSteps(traceId);

      if (selected === "json") {
        return {
          content: [{ type: "text", text: JSON.stringify({ traceId, steps }, null, 2) }]
        };
      }

      if (selected === "markdown") {
        return {
          content: [{ type: "text", text: renderTraceReasoningMarkdown(traceId) }]
        };
      }

      if (selected === "mermaid") {
        return {
          content: [{ type: "text", text: renderTraceReasoningMermaid(traceId) }]
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                traceId,
                steps,
                markdown: renderTraceReasoningMarkdown(traceId),
                mermaid: renderTraceReasoningMermaid(traceId)
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
