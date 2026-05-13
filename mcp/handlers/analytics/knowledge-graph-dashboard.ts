import { z } from "zod";
import { executeKnowledgeGraphDashboard } from "../../core/application/analytics/services/analytics-knowledge-dashboard.js";
import { LocalOutputsAdapter } from "../../infrastructure/outputs/local-outputs-adapter.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineKnowledgeGraphDashboardDeps extends RegisterGovToolDeps {
  outputsDir: string;
  listKnowledgeEntities: () => Array<{ id: string; name: string; type: string }>;
  listKnowledgeRelations: () => Array<{
    srcId: string;
    dstId: string;
    relationType: string;
    weight: number;
  }>;
}

export function defineKnowledgeGraphDashboardTool(
  deps: DefineKnowledgeGraphDashboardDeps
): void {
  const { govTool, outputsDir, listKnowledgeEntities, listKnowledgeRelations } = deps;

  const outputsPort = new LocalOutputsAdapter({ outputsDir });

  govTool(
    "knowledge_graph_dashboard",
    {
      title: "Knowledge Graph ダッシュボード",
      description: "Knowledge Graph の要約と Mermaid 可視化を返します。",
      inputSchema: {
        limitEntities: z.number().int().min(1).max(200).optional(),
        limitRelations: z.number().int().min(1).max(400).optional(),
        write: z.boolean().optional()
      }
    },
    async ({ limitEntities, limitRelations, write }: {
      limitEntities?: number;
      limitRelations?: number;
      write?: boolean;
    }) => {
      const payload = await executeKnowledgeGraphDashboard({
        limitEntities,
        limitRelations,
        write,
        listKnowledgeEntities,
        listKnowledgeRelations,
        outputsPort
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2)
          }
        ]
      };
    }
  );
}
