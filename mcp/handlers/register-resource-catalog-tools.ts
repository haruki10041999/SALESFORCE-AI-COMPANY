import { z } from "zod";
import { join, resolve } from "node:path";
import { buildResourceDependencyGraph, type ResourceDependencyGraphResult } from "../tools/resource-dependency-graph.js";
import type { RegisterGovToolDeps } from "./types.js";

type ListMdFiles = (dir: string) => { name: string; summary: string }[];
type GetMdFile = (dir: string, name: string) => string;

interface RegisterResourceCatalogToolsDeps extends RegisterGovToolDeps {
  listMdFiles: ListMdFiles;
  getMdFile: GetMdFile;
  rootDir: string;
  presetsDir: string;
}

export function registerResourceCatalogTools(deps: RegisterResourceCatalogToolsDeps): void {
  const { govTool, listMdFiles, getMdFile, rootDir, presetsDir } = deps;
  const outputsDir = process.env.SF_AI_OUTPUTS_DIR
    ? resolve(process.env.SF_AI_OUTPUTS_DIR)
    : join(rootDir, "outputs");

  govTool(
    "list_agents",
    {
      title: "エージェント一覧",
      description: "利用可能なAIエージェントを短い説明付きで一覧表示します。",
      inputSchema: {}
    },
    async () => {
      const agents = listMdFiles("agents");
      return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
    }
  );

  govTool(
    "get_agent",
    {
      title: "エージェント定義取得",
      description: "指定した名前のエージェント定義Markdown全文を返します。",
      inputSchema: { name: z.string() }
    },
    async ({ name }: { name: string }) => {
      const content = getMdFile("agents", name);
      return { content: [{ type: "text", text: content }] };
    }
  );

  govTool(
    "list_skills",
    {
      title: "スキル一覧",
      description: "利用可能なSalesforceスキルを短い説明付きで一覧表示します。",
      inputSchema: {}
    },
    async () => {
      const skills = listMdFiles("skills");
      return { content: [{ type: "text", text: JSON.stringify(skills, null, 2) }] };
    }
  );

  govTool(
    "get_skill",
    {
      title: "スキル定義取得",
      description: "指定した名前のスキルMarkdown全文を返します。",
      inputSchema: { name: z.string() }
    },
    async ({ name }: { name: string }) => {
      const content = getMdFile("skills", name);
      return { content: [{ type: "text", text: content }] };
    }
  );

  govTool(
    "list_personas",
    {
      title: "ペルソナ一覧",
      description: "利用可能なAIペルソナ（性格・コミュニケーションスタイル）を一覧表示します。",
      inputSchema: {}
    },
    async () => {
      const personas = listMdFiles("personas");
      return { content: [{ type: "text", text: JSON.stringify(personas, null, 2) }] };
    }
  );

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
        outputsDir,
        includeTypes,
        includeIsolated,
        impactTarget,
        maxImpacts,
        reportOutputDir
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

