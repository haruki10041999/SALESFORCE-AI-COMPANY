import type {
  CompletionRequest,
  CompletionResult,
  LlmCompletionPort
} from "../../core/ports/llm-completion-port.js";

interface AgentChatInput {
  topic: string;
  turns?: number;
}

type AgentChatTextPart = { type: "text"; text: string };
type AgentChatResultPart = AgentChatTextPart | { type: string; [key: string]: unknown };

interface AgentChatLike {
  chat(input: AgentChatInput): Promise<{ content: AgentChatResultPart[] }>;
}

function toCompletionText(response: { content: AgentChatResultPart[] }): string {
  return response.content
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n");
}

/**
 * Transitional adapter for T02: keeps CompletionPort usage stable while
 * current runtime still executes through agent chat orchestration.
 */
export function createCompletionPortFromAgentChat(agentChatService: AgentChatLike): LlmCompletionPort {
  return {
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const response = await agentChatService.chat({
        topic: req.prompt,
        turns: 1
      });

      return {
        text: toCompletionText(response),
        model: req.model,
        metadata: {
          source: "agent-chat-fallback"
        }
      };
    }
  };
}
