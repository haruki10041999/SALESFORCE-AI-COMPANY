import type { GovTool, GovToolConfig, GovToolHandler, RegisterToolFn } from "@mcp/tool-types.js";
import { isRetryableByCode, isRetryableError } from "../errors/tool-error.js";
import { startTrace, endTrace, failTrace } from "../trace/trace-context.js";
import { recordMetric } from "../../tools/metrics.js";

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

  function govTool<TInput = unknown>(name: string, config: GovToolConfig, handler: GovToolHandler<TInput>): void {
    registerTool(name, config, async (input: unknown) => {
      const startedAt = new Date();
      const traceId = startTrace(name, { input: summarizeValue(input) });
      await emitSystemEvent("tool_before_execute", {
        toolName: name,
        traceId,
        input: summarizeValue(input)
      });

      if (isToolDisabled(normalizeResourceName(name))) {
        await emitSystemEvent("tool_after_execute", {
          toolName: name,
          traceId,
          success: false,
          blockedByDisable: true,
          error: "tool disabled"
        });
        endTrace(traceId, { blockedByDisable: true });
        recordMetric({
          toolName: name,
          traceId,
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          status: "error"
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
            traceId,
            success: true,
            contentCount: Array.isArray(result?.content) ? result.content.length : 0,
            attempts: attempt + 1,
            retried: attempt > 0
          });
          endTrace(traceId, { success: true, attempts: attempt + 1 });
          recordMetric({
            toolName: name,
            traceId,
            startedAt: startedAt.toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
            status: "success"
          });
          return result;
        } catch (error) {
          const retryable = retryConfig.retryEnabled && (
            isRetryableError(error, patterns) || isRetryableByCode(error, retryableCodes)
          );
          if (!retryable || attempt >= maxRetries) {
            await emitSystemEvent("tool_after_execute", {
              toolName: name,
              traceId,
              success: false,
              error: summarizeValue(error, 500),
              attempts: attempt + 1,
              retried: attempt > 0
            });
            await registerToolFailure(name, error);
            failTrace(traceId, error);
            recordMetric({
              toolName: name,
              traceId,
              startedAt: startedAt.toISOString(),
              durationMs: Date.now() - startedAt.getTime(),
              status: "error"
            });
            throw error;
          }

          const backoffMs = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
          await emitSystemEvent("tool_after_execute", {
            toolName: name,
            traceId,
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

