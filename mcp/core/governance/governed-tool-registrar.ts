import type { GovTool, GovToolConfig, GovToolHandler, RegisterToolFn } from "@mcp/tool-types.js";
import { isRetryableByCode, isRetryableError } from "../errors/tool-error.js";
import { startTrace, endTrace, failTrace } from "../trace/trace-context.js";
import { recordMetric } from "../../tools/metrics.js";
import { addMemory } from "../../../memory/project-memory.js";
import { addRecord as addVectorRecord } from "../../../memory/vector-store.js";
import { buildProgressBanner } from "../progress/progress-formatter.js";
import { appendExecutionOrigin, buildExecutionOriginRecord } from "./outputs-origin.js";

const PROGRESS_BANNER_SKIP_TOOLS = new Set([
  // 進捗表示の意味が薄い軽量ツール (応答が JSON のみで構造化されているもの含む)
  "get_tool_progress",
  "ping"
]);

function isProgressBannerEnabled(toolName: string): boolean {
  if (PROGRESS_BANNER_SKIP_TOOLS.has(toolName)) return false;
  const value = (process.env.SF_AI_PROGRESS_BANNER ?? "true").toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

function attachProgressBanner<T extends { content?: Array<{ type: string; text: string }> }>(
  toolName: string,
  traceId: string,
  result: T
): T {
  if (!result || !Array.isArray(result.content)) return result;
  if (!isProgressBannerEnabled(toolName)) return result;
  const banner = buildProgressBanner(traceId, { title: "進捗タイムライン" });
  if (!banner) return result;
  return {
    ...result,
    content: [{ type: "text", text: banner }, ...result.content]
  };
}

const AUTO_MEMORY_SKIP_TOOLS = new Set([
  "add_memory",
  "clear_memory",
  "list_memory",
  "search_memory",
  "add_vector_record",
  "query_vector_store",
  "clear_vector_store"
]);

function isAutoMemoryEnabled(): boolean {
  const value = (process.env.SF_AI_AUTO_MEMORY ?? "").toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

function recordToolExecutionToMemory(
  toolName: string,
  traceId: string,
  inputSummary: string,
  outputSummary: string,
  status: "success" | "error"
): void {
  if (!isAutoMemoryEnabled()) {
    return;
  }
  if (AUTO_MEMORY_SKIP_TOOLS.has(toolName)) {
    return;
  }
  try {
    const ts = new Date().toISOString();
    const text = `[${ts}] ${toolName} (${status}) trace=${traceId}\nINPUT: ${inputSummary}\nOUTPUT: ${outputSummary}`;
    addMemory(text);
    addVectorRecord({
      id: `${traceId}-${toolName}`,
      text,
      tags: ["auto-memory", `tool:${toolName}`, `status:${status}`]
    });
  } catch {
    // 自動記録の失敗はツール実行を阻害しない
  }
}

type ToolResponse = { content: Array<{ type: string; text: string }> };

interface CreateGovernedToolRegistrarDeps {
  registerTool: RegisterToolFn;
  isToolDisabled: (toolName: string) => boolean;
  normalizeResourceName: (name: string) => string;
  outputsDir: string;
  serverRoot: string;
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
    outputsDir,
    serverRoot,
    emitSystemEvent,
    summarizeValue,
    registerToolFailure,
    getRetryConfig
  } = deps;

  function recordExecutionOrigin(toolName: string, input: unknown, status: "success" | "error"): void {
    try {
      appendExecutionOrigin(outputsDir, buildExecutionOriginRecord(toolName, input, status, serverRoot));
    } catch {
      // provenance 記録失敗はツール実行を阻害しない
    }
  }

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
          recordToolExecutionToMemory(
            name,
            traceId,
            summarizeValue(input),
            summarizeValue(result),
            "success"
          );
          recordExecutionOrigin(name, input, "success");
          return attachProgressBanner(name, traceId, result);
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
            recordToolExecutionToMemory(
              name,
              traceId,
              summarizeValue(input),
              summarizeValue(error, 500),
              "error"
            );
            recordExecutionOrigin(name, input, "error");
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

