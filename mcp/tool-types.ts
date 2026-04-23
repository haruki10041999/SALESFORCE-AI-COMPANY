export interface GovToolConfig {
  title?: string;
  description?: string;
  tags?: string[];
  inputSchema?: unknown;
}

export interface GovToolResponse {
  content: Array<{ type: string; text: string }>;
}

export type GovToolHandler<TInput = unknown> = (input: TInput) => Promise<GovToolResponse>;

export type GovTool = <TInput = unknown>(
  name: string,
  config: GovToolConfig,
  handler: GovToolHandler<TInput>
) => void;

export type RegisterToolFn = GovTool;