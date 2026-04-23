import type { GovTool, GovToolConfig, GovToolHandler, RegisterToolFn } from "@mcp/tool-types.js";

type ToolResponse = { content: Array<{ type: string; text: string }> };

interface CreateGovernedToolRegistrarDeps {
  registerTool: RegisterToolFn;
  isToolDisabled: (toolName: string) => boolean;
  normalizeResourceName: (name: string) => string;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  summarizeValue: (value: unknown, maxLength?: number) => string;
  registerToolFailure: (toolName: string, error: unknown) => Promise<void>;
  getRetryConfig: () => Promise<{
    retryEnabled: boolean;
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retryablePatterns: string[];
    retryableCodes: string[];
  }>;
}

export function createGovernedToolRegistrar(deps: CreateGovernedToolRegistrarDeps) {
  const {
    registerTool,
    isToolDisabled,
    normalizeResourceName,
    emitSystemEvent,
    summarizeValue,
    registerToolFailure,
    getRetryConfig
  } = deps;

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`.toLowerCase();
    }
    return String(error).toLowerCase();
  }

  function isRetryableError(error: unknown, patterns: string[]): boolean {
    const message = toErrorMessage(error);
    return patterns.some((pattern) => message.includes(pattern.toLowerCase()));
  }

  function readErrorCode(error: unknown): string {
    if (!error || typeof error !== "object") {
      return "";
    }
    const candidate = error as {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
      cause?: { code?: unknown; status?: unknown; statusCode?: unknown };
    };
    const raw =
      candidate.code ??
      candidate.statusCode ??
      candidate.status ??
      candidate.cause?.code ??
      candidate.cause?.statusCode ??
      candidate.cause?.status;
    if (raw === undefined || raw === null) {
      return "";
    }
    return String(raw).toUpperCase();
  }

  function isRetryableByCode(error: unknown, codes: string[]): boolean {
    const code = readErrorCode(error);
    if (!code) {
      return false;
    }
    const normalizedCodes = codes.map((item) => item.toUpperCase());
    return normalizedCodes.includes(code);
  }

  function govTool<TInput = unknown>(name: string, config: GovToolConfig, handler: GovToolHandler<TInput>): void {
    registerTool(name, config, async (input: unknown) => {
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
              text: "Auto-generated text.",
            }
          ]
        };
      }

      const retryConfig = await getRetryConfig();
      const maxRetries = retryConfig.retryEnabled
        ? Math.max(0, Math.min(5, retryConfig.maxRetries))
        : 0;
      const baseDelayMs = Math.max(10, retryConfig.baseDelayMs);
      const maxDelayMs = Math.max(baseDelayMs, retryConfig.maxDelayMs);
      const patterns = retryConfig.retryablePatterns ?? [];
      const retryableCodes = retryConfig.retryableCodes ?? [];

      let attempt = 0;
      while (true) {
        try {
          const result = await handler(input as TInput);
          await emitSystemEvent("tool_after_execute", {
            toolName: name,
            success: true,
            contentCount: Array.isArray(result?.content) ? result.content.length : 0,
            attempts: attempt + 1,
            retried: attempt > 0
          });
          return result;
        } catch (error) {
          const retryable = retryConfig.retryEnabled && (
            isRetryableError(error, patterns) || isRetryableByCode(error, retryableCodes)
          );
          if (!retryable || attempt >= maxRetries) {
            await emitSystemEvent("tool_after_execute", {
              toolName: name,
              success: false,
              error: summarizeValue(error, 500),
              attempts: attempt + 1,
              retried: attempt > 0
            });
            await registerToolFailure(name, error);
            throw error;
          }

          const backoffMs = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
          await emitSystemEvent("tool_after_execute", {
            toolName: name,
            success: false,
            retryScheduled: true,
            retryAttempt: attempt + 1,
            nextBackoffMs: backoffMs,
            error: summarizeValue(error, 500)
          });
          await delay(backoffMs);
          attempt += 1;
        }
      }
    });
  }

  return { govTool };
}

