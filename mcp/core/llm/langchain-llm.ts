import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import type { OllamaChatRequest, OllamaChatResponse } from "./ollama-client.js";

export interface LangChainLlmClientOptions {
  baseUrl?: string;
}

function asStringContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

export class LangChainLlmClient {
  private readonly baseUrl?: string;

  constructor(options: LangChainLlmClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL;
  }

  public async chat(req: OllamaChatRequest): Promise<OllamaChatResponse> {
    const chat = new ChatOllama({
      baseUrl: this.baseUrl,
      model: req.model,
      ...(req.options ? { modelKwargs: req.options } : {})
    });

    const messages = req.messages.map((message) => {
      if (message.role === "system") return new SystemMessage(message.content);
      if (message.role === "assistant") return new AIMessage(message.content);
      return new HumanMessage(message.content);
    });

    const out = await chat.invoke(messages);
    return {
      model: req.model,
      message: {
        role: "assistant",
        content: asStringContent(out.content)
      },
      done: true
    };
  }
}

let DEFAULT_LANGCHAIN_CLIENT: LangChainLlmClient | null = null;

export function getDefaultLangChainLlmClient(): LangChainLlmClient {
  if (!DEFAULT_LANGCHAIN_CLIENT) {
    DEFAULT_LANGCHAIN_CLIENT = new LangChainLlmClient();
  }
  return DEFAULT_LANGCHAIN_CLIENT;
}

export function _setDefaultLangChainLlmClientForTest(client: LangChainLlmClient | null): void {
  DEFAULT_LANGCHAIN_CLIENT = client;
}
