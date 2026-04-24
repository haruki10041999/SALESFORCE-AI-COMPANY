import { z } from "zod";
import type { GovTool } from "@mcp/tool-types.js";

interface RegisterVectorPromptToolsDeps {
  govTool: GovTool;
  addRecord: (record: { id: string; text: string; tags: string[] }) => void;
  searchByKeyword: (query: string) => Array<{ id: string; text: string; tags?: string[] }>;
  buildPrompt: (agent: { name: string; content: string }, task: string) => string;
  evaluatePromptMetrics: (prompt: string, skills?: string[], triggerKeywords?: string[]) => {
    lengthChars: number;
    lineCount: number;
    estimatedTokens: number;
    containsProjectContext: boolean;
    containsAgentsSection: boolean;
    containsSkillsSection: boolean;
    containsTaskSection: boolean;
    skillCoverageRate: number;
    triggerMatchRate: number;
  };
}

export function registerVectorPromptTools(deps: RegisterVectorPromptToolsDeps): void {
  const { govTool, addRecord, searchByKeyword, buildPrompt, evaluatePromptMetrics } = deps;

  govTool(
    "add_vector_record",
    {
      title: "ベクトルレコード追加",
      description: "ベクトルストアにレコードを追加します。",
      inputSchema: {
        id: z.string().min(1),
        text: z.string().min(1),
        tags: z.array(z.string()).optional()
      }
    },
    async ({ id, text, tags }: { id: string; text: string; tags?: string[] }) => {
      addRecord({ id, text, tags: tags ?? [] });
      return {
        content: [{ type: "text", text: `Vector record added: ${id}` }]
      };
    }
  );

  govTool(
    "search_vector",
    {
      title: "ベクトル検索",
      description: "ベクトルストアを検索します。",
      inputSchema: {
        query: z.string().min(1)
      }
    },
    async ({ query }: { query: string }) => {
      const results = searchByKeyword(query);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ query, count: results.length, results }, null, 2)
          }
        ]
      };
    }
  );

  govTool(
    "build_prompt",
    {
      title: "プロンプト構築",
      description: "ベースプロンプトと推論フレームワークから単一エージェント用プロンプトを構築します。",
      inputSchema: {
        agentName: z.string(),
        agentContent: z.string(),
        task: z.string()
      }
    },
    async ({ agentName, agentContent, task }: { agentName: string; agentContent: string; task: string }) => {
      const prompt = buildPrompt({ name: agentName, content: agentContent }, task);
      return {
        content: [{ type: "text", text: prompt }]
      };
    }
  );

  govTool(
    "evaluate_prompt_metrics",
    {
      title: "プロンプト評価指標",
      description: "長さ・セクション網羅率・スキル網羅率・トリガー一致率などのプロンプト品質指標を評価します。",
      inputSchema: {
        prompt: z.string().min(1),
        skills: z.array(z.string()).optional(),
        triggerKeywords: z.array(z.string()).optional()
      }
    },
    async ({ prompt, skills, triggerKeywords }: { prompt: string; skills?: string[]; triggerKeywords?: string[] }) => {
      const metrics = evaluatePromptMetrics(prompt, skills, triggerKeywords);
      return {
        content: [{ type: "text", text: JSON.stringify(metrics, null, 2) }]
      };
    }
  );
}

