export interface CompletionRequest {
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface CompletionResult {
  text: string;
  model?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface CompletionChunk {
  textDelta: string;
}

export interface LlmCompletionPort {
  complete(req: CompletionRequest): Promise<CompletionResult>;
  stream?(req: CompletionRequest): AsyncIterable<CompletionChunk>;
}
