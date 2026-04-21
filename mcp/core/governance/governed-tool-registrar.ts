type ToolResponse = { content: Array<{ type: string; text: string }> };

type RegisterToolFn = (name: string, config: any, handler: any) => void;

interface CreateGovernedToolRegistrarDeps {
  registerTool: RegisterToolFn;
  isToolDisabled: (toolName: string) => boolean;
  normalizeResourceName: (name: string) => string;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  summarizeValue: (value: unknown, maxLength?: number) => string;
  registerToolFailure: (toolName: string, error: unknown) => Promise<void>;
}

export function createGovernedToolRegistrar(deps: CreateGovernedToolRegistrarDeps) {
  const {
    registerTool,
    isToolDisabled,
    normalizeResourceName,
    emitSystemEvent,
    summarizeValue,
    registerToolFailure
  } = deps;

  function govTool(name: string, config: any, handler: any): void {
    registerTool(name as any, config as any, (async (input: any) => {
      await emitSystemEvent("tool_before_execute", {
        toolName: name,
        input: summarizeValue(input)
      });

      if (isToolDisabled(normalizeResourceName(name))) {
        await emitSystemEvent("tool_after_execute", {
          toolName: name,
          success: false,
          blockedByDisable: true,
          error: "tool disabled"
        });
        return {
          content: [
            {
              type: "text",
              text: "ツール \"" + name + "\" は現在無効化されています。apply_resource_actions で enable してから使用してください。"
            }
          ]
        };
      }

      try {
        const result = await (handler as (input: unknown) => Promise<ToolResponse>)(input);
        await emitSystemEvent("tool_after_execute", {
          toolName: name,
          success: true,
          contentCount: Array.isArray(result?.content) ? result.content.length : 0
        });
        return result;
      } catch (error) {
        await emitSystemEvent("tool_after_execute", {
          toolName: name,
          success: false,
          error: summarizeValue(error, 500)
        });
        await registerToolFailure(name, error);
        throw error;
      }
    }) as any);
  }

  return { govTool };
}
