import { z } from "zod";
import { simulateFlowCondition } from "../../tools/flow-condition-simulator.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineFlowConditionSimulateDeps extends RegisterGovToolDeps {}

export function defineFlowConditionSimulateTool(deps: DefineFlowConditionSimulateDeps): void {
  const { govTool } = deps;

  govTool(
    "flow_condition_simulate",
    {
      title: "Flow条件シミュレータ",
      description: "入力レコードと条件ツリーを評価し、Flow が起動するかを判定します。",
      inputSchema: {
        flowName: z.string().optional(),
        record: z.record(z.string(), z.any()),
        condition: z.any()
      }
    },
    async ({
      flowName,
      record,
      condition
    }: {
      flowName?: string;
      record: Record<string, unknown>;
      condition: unknown;
    }) => {
      const result = simulateFlowCondition({
        flowName,
        record,
        condition: condition as never
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  // Compatibility alias: older task naming
  govTool(
    "simulate_flow_conditions",
    {
      title: "Flow条件シミュレータ (alias)",
      description: "flow_condition_simulate の互換エイリアスです。",
      inputSchema: {
        flowName: z.string().optional(),
        record: z.record(z.string(), z.any()),
        condition: z.any()
      }
    },
    async ({
      flowName,
      record,
      condition
    }: {
      flowName?: string;
      record: Record<string, unknown>;
      condition: unknown;
    }) => {
      const result = simulateFlowCondition({
        flowName,
        record,
        condition: condition as never
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
