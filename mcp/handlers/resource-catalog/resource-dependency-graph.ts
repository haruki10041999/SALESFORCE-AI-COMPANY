import { z } from "zod";
import { buildResourceDependencyGraph, type ResourceDependencyGraphResult } from "../../tools/resource-dependency-graph.js";
import type { RegisterResourceCatalogToolsDeps } from "../register-resource-catalog-tools.js";

export function defineResourceDependencyGraphTool(deps: RegisterResourceCatalogToolsDeps): void {
  const { govTool, rootDir, presetsDir } = deps;

  govTool(
    "resource_dependency_graph",
    {
      title: "リソース依存ネットワーク可視化",
      description: "スキル/エージェント/ペルソナ/プリセット間の依存関係を抽出し、Mermaid と影響範囲を返します。",
      inputSchema: {
        includeTypes: z.array(z.enum(["skills", "agents", "personas", "presets"])).optional(),
        includeIsolated: z.boolean().optional(),
        impactTarget: z.object({
          type: z.enum(["skills", "agents", "personas", "presets"]),
          name: z.string()
        }).optional(),
        maxImpacts: z.number().int().min(1).max(500).optional(),
        reportOutputDir: z.string().optional()
      }
    },
    async ({
      includeTypes,
      includeIsolated,
      impactTarget,
      maxImpacts,
      reportOutputDir
    }: {
      includeTypes?: Array<"skills" | "agents" | "personas" | "presets">;
      includeIsolated?: boolean;
      impactTarget?: { type: "skills" | "agents" | "personas" | "presets"; name: string };
      maxImpacts?: number;
      reportOutputDir?: string;
    }) => {
      const result: ResourceDependencyGraphResult = await buildResourceDependencyGraph({
        rootDir,
        presetsDir,
        includeTypes,
        includeIsolated,
        impactTarget,
        maxImpacts,
        reportOutputDir
      });
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
          { type: "text", text: `\`\`\`mermaid\n${result.mermaid}\n\`\`\`` }
        ]
      };
    }
  );
}
