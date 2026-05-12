import { z } from "zod";
import { runAgentAbTest } from "../../tools/agent-ab-test.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineAgentAbTestDeps extends RegisterGovToolDeps {
  runChatTool: any;
  evaluatePromptMetrics: any;
  outputsDir: string;
}

export function defineAgentAbTestTool(deps: DefineAgentAbTestDeps): void {
  const { govTool, runChatTool, evaluatePromptMetrics, outputsDir } = deps;

  govTool(
    "agent_ab_test",
    {
      title: "エージェントA/B比較",
      description: "同一トピックで2エージェントのチャット出力品質と実行時間を比較します。",
      inputSchema: {
        topic: z.string(),
        agentA: z.string(),
        agentB: z.string(),
        filePaths: z.array(z.string()).optional(),
        persona: z.string().optional(),
        skills: z.array(z.string()).optional(),
        turns: z.number().int().min(1).max(30).optional(),
        maxContextChars: z.number().int().min(500).max(200000).optional(),
        appendInstruction: z.string().optional(),
        reportOutputDir: z.string().optional(),
        applyOutcomeToTrustStore: z.boolean().optional(),
        trustStoreFilePath: z.string().optional()
      }
    },
    async ({
      topic,
      agentA,
      agentB,
      filePaths,
      persona,
      skills,
      turns,
      maxContextChars,
      appendInstruction,
      reportOutputDir,
      applyOutcomeToTrustStore,
      trustStoreFilePath
    }: {
      topic: string;
      agentA: string;
      agentB: string;
      filePaths?: string[];
      persona?: string;
      skills?: string[];
      turns?: number;
      maxContextChars?: number;
      appendInstruction?: string;
      reportOutputDir?: string;
      applyOutcomeToTrustStore?: boolean;
      trustStoreFilePath?: string;
    }) => {
      const result = await runAgentAbTest(
        {
          topic,
          agentA,
          agentB,
          filePaths,
          persona,
          skills,
          turns,
          maxContextChars,
          appendInstruction,
          reportOutputDir,
          applyOutcomeToTrustStore,
          trustStoreFilePath
        },
        {
          runChatTool,
          evaluatePromptMetrics,
          outputsDir
        }
      );

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

