export interface LlmGateway {
  chat(input: {
    topic: string;
    filePaths?: string[];
    agents?: string[];
    persona?: string;
    skills?: string[];
    turns?: number;
    maxContextChars?: number;
    appendInstruction?: string;
  }): Promise<{ content: Array<{ type: string; text: string }> }>;
}
