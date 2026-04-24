import { z } from "zod";
import type { RegisterGovToolDeps } from "./types.js";

type ListMdFiles = (dir: string) => { name: string; summary: string }[];
type GetMdFile = (dir: string, name: string) => string;

interface RegisterResourceCatalogToolsDeps extends RegisterGovToolDeps {
  listMdFiles: ListMdFiles;
  getMdFile: GetMdFile;
}

export function registerResourceCatalogTools(deps: RegisterResourceCatalogToolsDeps): void {
  const { govTool, listMdFiles, getMdFile } = deps;

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
}

