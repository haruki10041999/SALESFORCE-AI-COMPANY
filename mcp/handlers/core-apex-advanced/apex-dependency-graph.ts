import { z } from "zod";
import { executeApexDependencyGraphTool } from "../../core/application/analysis/services/analysis-apex-dependency-graph-tool.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineApexDependencyGraphDeps extends RegisterGovToolDeps {}

export function defineApexDependencyGraphTool(deps: DefineApexDependencyGraphDeps): void {
  const { govTool } = deps;

  govTool(
    "apex_dependency_graph",
    {
      title: "Apex依存グラフ可視化",
      description: "Apexクラス/トリガーの依存関係を解析し、グラフ情報とMermaidを返します。Flow/PermissionSet/外部連携も任意で含められます。",
      inputSchema: {
        rootDir: z.string(),
        includeTests: z.boolean().optional(),
        sampleLimit: z.number().int().min(1).max(100).optional(),
        includeFlows: z.boolean().optional(),
        includePermissionSets: z.boolean().optional(),
        includeIntegrations: z.boolean().optional()
      }
    },
    async ({ rootDir, includeTests, sampleLimit, includeFlows, includePermissionSets, includeIntegrations }: {
      rootDir: string;
      includeTests?: boolean;
      sampleLimit?: number;
      includeFlows?: boolean;
      includePermissionSets?: boolean;
      includeIntegrations?: boolean;
    }) => {
      return executeApexDependencyGraphTool({
        rootDir,
        includeTests,
        sampleLimit,
        includeFlows,
        includePermissionSets,
        includeIntegrations
      });
    }
  );
}
