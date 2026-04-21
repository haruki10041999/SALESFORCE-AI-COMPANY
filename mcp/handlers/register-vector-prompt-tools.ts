import { z } from "zod";

type GovTool = (name: string, config: any, handler: any) => void;

interface RegisterVectorPromptToolsDeps {
  govTool: GovTool;
  addRecord: (record: { id: string; text: string; tags: string[] }) => void;
  searchByKeyword: (query: string) => Array<{ id: string; text: string; tags?: string[] }>;
  buildPrompt: (agent: { name: string; content: string }, task: string) => string;
}

export function registerVectorPromptTools(deps: RegisterVectorPromptToolsDeps): void {
  const { govTool, addRecord, searchByKeyword, buildPrompt } = deps;

  govTool(
    "add_vector_record",
    {
      title: "Add Vector Record",
      description: "id / text / tags でベクターストアにレコードを追加します。",
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
      title: "Search Vector",
      description: "ベクターストアをキーワードで検索します（text と tags に対してマッチ）。",
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
      title: "Build Prompt",
      description:
        "単一エージェント用のプロンプトを base-prompt.md + reasoning-framework.md を組み合わせて生成します。chat より軽量な単発タスク向け。",
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
}
