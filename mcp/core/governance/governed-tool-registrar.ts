import type { GovToolConfig, GovToolHandler, RegisterToolFn } from "@mcp/tool-types.js";
import type { BanditState } from "../learning/rl-feedback.js";
import { saveBanditState } from "../learning/rl-feedback.js";
import { isRetryableByCode, isRetryableError } from "../errors/tool-error.js";
import { startTrace, endTrace, failTrace } from "../trace/trace-context.js";
import { ToolExecutionRecorder } from "../trace/tool-recorder.js";
import { recordMetric } from "../../tools/metrics.js";
import { addMemory } from "../../../memory/project-memory.js";
import { addRecord as addVectorRecord } from "../../../memory/vector-store.js";
import { buildProgressBanner } from "../progress/progress-formatter.js";
import { defineTool, type ToolDefinition } from "../registry/define-tool.js";
import { PostgresRuntimeLogStore } from "../persistence/postgres-runtime-log-store.js";
import { OutputsArtifactWriter } from "../persistence/outputs-artifact-writer.js";
import { appendExecutionOrigin, buildExecutionOriginRecord } from "./outputs-origin.js";
import { authorizeToolExecution } from "../identity/rbac.js";
import { evaluateExecutionPolicy, loadExecutionPolicy } from "./execution-policy.js";
import { createPolicyGate, buildBlockedResponse } from "./policy-gate.js";
import { CostBudgetManager, buildCostUsageFromInputOutput } from "./cost-budget.js";
import { isEnvFlagEnabled } from "../config/env-flags.js";
import { getPrimaryModel, getReplayMode } from "../config/runtime-config.js";
import { getGlobalToolRateLimiter, type ToolRateLimiter } from "../reliability/rate-limiter.js";
import {
  extractActorFromToolInput,
  mergeActorIdentity,
  resolveDefaultActorFromEnv
} from "../identity/actor.js";
import { resolveActorFromOidcInput } from "../identity/oidc-verifier.js";
import { currentActor, runWithActorContext } from "../identity/actor-context.js";

const PROGRESS_BANNER_SKIP_TOOLS = new Set([
  // 進捗表示の意味が薄い軽量ツール (応答が JSON のみで構造化されているもの含む)
  "get_tool_progress",
  "ping"
]);

function isProgressBannerEnabled(toolName: string): boolean {
  if (PROGRESS_BANNER_SKIP_TOOLS.has(toolName)) return false;
  return isEnvFlagEnabled("SF_AI_PROGRESS_BANNER", process.env, true);
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
  return isEnvFlagEnabled("SF_AI_AUTO_MEMORY");
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
    void addMemory(text).catch(() => {
      // ignore memory persistence errors
    });
    addVectorRecord({
      id: `${traceId}-${toolName}`,
      text,
      tags: ["auto-memory", `tool:${toolName}`, `status:${status}`]
    });
  } catch {
    // 自動記録の失敗はツール実行を阻害しない
  }
}

interface CreateGovernedToolRegistrarDeps {
  registerTool: RegisterToolFn;
  isToolDisabled: (toolName: string) => boolean;
  normalizeResourceName: (name: string) => string;
  outputsDir: string;
  databaseUrl?: string;
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
  getBanditState: () => BanditState;
  banditStateFile: string;
  rateLimiter?: ToolRateLimiter;
  onToolDefined?: (definition: ToolDefinition) => void;
}

export function createGovernedToolRegistrar(deps: CreateGovernedToolRegistrarDeps) {
  const {
    registerTool,
    isToolDisabled,
    normalizeResourceName,
    outputsDir,
    databaseUrl,
    serverRoot,
    emitSystemEvent,
    summarizeValue,
    registerToolFailure,
    getRetryConfig,
    getBanditState,
    banditStateFile,
    rateLimiter: injectedRateLimiter,
    onToolDefined
  } = deps;
  const rateLimiter = injectedRateLimiter ?? getGlobalToolRateLimiter();
  const runtimeStorePromise = databaseUrl
    ? PostgresRuntimeLogStore.open({ databaseUrl }).catch(() => null)
    : Promise.resolve(null);
  const artifactWriter = new OutputsArtifactWriter({
    outputsDir,
    databaseUrl
  });
  const toolRecorder = new ToolExecutionRecorder({
    outputsDir,
    databaseUrl
  });
  const costBudget = new CostBudgetManager({ outputsDir });

  function isCostBudgetEnforcerEnabled(): boolean {
    return isEnvFlagEnabled("SF_AI_COST_BUDGET_ENFORCER_ENABLED", process.env, true);
  }

  function resolveModelName(input: unknown): string {
    if (input && typeof input === "object") {
      const record = input as Record<string, unknown>;
      for (const key of ["model", "modelName", "llmModel"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim().length > 0) {
          return value.trim();
        }
      }
    }
    return getPrimaryModel();
  }

  function recordExecutionOrigin(toolName: string, input: unknown, status: "success" | "error"): void {
    try {
      void appendExecutionOrigin(outputsDir, buildExecutionOriginRecord(toolName, input, status, serverRoot));
    } catch {
      // provenance 記録失敗はツール実行を阻害しない
    }
  }

  async function appendToolAudit(entry: Record<string, unknown>): Promise<void> {
    const actor = currentActor();
    const record = {
      actorType: actor.type,
      actorId: actor.id,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      ...entry
    };
    try {
      await artifactWriter.appendAuditArtifact(
        "tool_execution",
        "tools",
        record,
        new Date().toISOString(),
        "audit/tool-executions.jsonl"
      );
    } catch {
      // audit logging failures should not block tool execution
    }
  }

  // Policy gate enforces dangerous-action catalog before every tool execution
  const policyGate = createPolicyGate({
    onBlocked: async (toolName, entry, _input) => {
      await appendToolAudit({
        toolName,
        status: "blocked-policy-gate",
        riskLevel: entry.riskLevel,
        actionType: entry.actionType
      });
    }
  });

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isZodSchema(value: unknown): value is { safeParse: (input: unknown) => unknown; _def: unknown } {
    return typeof value === "object"
      && value !== null
      && typeof (value as { safeParse?: unknown }).safeParse === "function"
      && "_def" in value;
  }

  function govTool<TInput = unknown>(name: string, config: GovToolConfig, handler: GovToolHandler<TInput>): void {
    const rawSchema = config.inputSchema;
    const toolDefinition = defineTool({
      name,
      title: config.title,
      description: config.description,
      tags: config.tags,
      ...(isZodSchema(rawSchema)
        ? { inputSchemaZod: rawSchema as unknown as import("zod").ZodTypeAny }
        : (typeof rawSchema === "object" && rawSchema !== null ? { inputSchema: rawSchema as Record<string, unknown> } : {}))
    });
    onToolDefined?.(toolDefinition);

    registerTool(name, config, async (input: unknown) => {
      const baseActor = resolveDefaultActorFromEnv();
      const actorFromInput = extractActorFromToolInput(input);
      const actorFromOidc = await resolveActorFromOidcInput(input).catch((error) => {
        throw new Error(`OIDC verification failed: ${summarizeValue(error, 400)}`);
      });
      const actor = actorFromOidc
        ? mergeActorIdentity(mergeActorIdentity(baseActor, actorFromInput), actorFromOidc)
        : mergeActorIdentity(baseActor, actorFromInput);

      return runWithActorContext(actor, async () => {
      const startedAt = new Date();
      const inputSummary = summarizeValue(input);
      const traceId = startTrace(name, { input: inputSummary });
      const sessionId = typeof (input as { sessionId?: unknown } | null | undefined)?.sessionId === "string"
        ? (input as { sessionId: string }).sessionId
        : undefined;
      const modelName = resolveModelName(input);
      // T-OBS-01: OTel span 開始 (no-op when OTEL_ENABLED!=true)
      void import("../observability/otel-tracer.js")
        .then((m) => m.notifyOtelTraceStart(traceId, name))
        .catch(() => {});
      await emitSystemEvent("tool_before_execute", {
        toolName: name,
        traceId,
        input: inputSummary
      });

      const access = await authorizeToolExecution(actor, normalizeResourceName(name), serverRoot);
      if (!access.allowed) {
        await emitSystemEvent("tool_after_execute", {
          toolName: name,
          traceId,
          success: false,
          blockedByRbac: true,
          role: access.role,
          reason: access.reason ?? "rbac denied"
        });
        endTrace(traceId, { blockedByRbac: true, role: access.role });
        recordMetric({
          toolName: name,
          traceId,
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          status: "error"
        });
        await appendToolAudit({
          toolName: name,
          traceId,
          status: "blocked-rbac",
          role: access.role,
          reason: access.reason ?? "rbac denied",
          input: summarizeValue(input)
        });
        return {
          content: [
            {
              type: "text",
              text: `RBAC denied: tool='${name}', role='${access.role}', reason='${access.reason ?? "not allowed"}'`
            }
          ]
        };
      }

      const policy = await loadExecutionPolicy(outputsDir);
      const policyDecision = evaluateExecutionPolicy({
        policy,
        toolName: normalizeResourceName(name),
        role: access.role,
        input
      });
      if (!policyDecision.allowed) {
        await emitSystemEvent("tool_after_execute", {
          toolName: name,
          traceId,
          success: false,
          blockedByExecutionPolicy: true,
          role: access.role,
          rule: policyDecision.rule,
          reason: policyDecision.reason
        });
        endTrace(traceId, { blockedByExecutionPolicy: true, role: access.role, rule: policyDecision.rule });
        recordMetric({
          toolName: name,
          traceId,
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          status: "error"
        });
        await appendToolAudit({
          toolName: name,
          traceId,
          status: "blocked-execution-policy",
          role: access.role,
          rule: policyDecision.rule,
          reason: policyDecision.reason,
          input: summarizeValue(input)
        });
        return {
          content: [
            {
              type: "text",
              text: `Execution policy denied: tool='${name}', role='${access.role}', reason='${policyDecision.reason ?? "policy denied"}'`
            }
          ]
        };
      }

      // Dangerous-action policy gate: block irreversible operations that require approval
      const policyCheck = await policyGate.check(name, input);
      if (policyCheck.blocked) {
        await emitSystemEvent("tool_after_execute", {
          toolName: name,
          traceId,
          success: false,
          blockedByPolicyGate: true,
          riskLevel: policyCheck.entry.riskLevel
        });
        endTrace(traceId, { blockedByPolicyGate: true });
        return buildBlockedResponse(policyCheck);
      }

      if (isToolDisabled(normalizeResourceName(name))) {
        await emitSystemEvent("tool_after_execute", {
          toolName: name,
          traceId,
          success: false,
          blockedByDisable: true,
          error: "tool disabled"
        });
        endTrace(traceId, { blockedByDisable: true });
        void import("../observability/otel-tracer.js")
          .then((m) => m.notifyOtelTraceEnd(traceId, { "sfai.disabled": true }))
          .catch(() => {});
        recordMetric({
          toolName: name,
          traceId,
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          status: "error"
        });
        await appendToolAudit({
          toolName: name,
          traceId,
          status: "blocked-disabled",
          input: summarizeValue(input)
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

      const rateLimitDecision = rateLimiter.check({
        actorId: actor.id,
        tenantId: actor.tenantId ?? "global",
        toolName: normalizeResourceName(name)
      });
      if (!rateLimitDecision.allowed) {
        await emitSystemEvent("tool_after_execute", {
          toolName: name,
          traceId,
          success: false,
          blockedByRateLimit: true,
          code: "rate_limited",
          scope: rateLimitDecision.scope,
          retryAfterMs: rateLimitDecision.retryAfterMs
        });
        endTrace(traceId, {
          blockedByRateLimit: true,
          scope: rateLimitDecision.scope,
          retryAfterMs: rateLimitDecision.retryAfterMs
        });
        recordMetric({
          toolName: name,
          traceId,
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          status: "error"
        });
        await appendToolAudit({
          toolName: name,
          traceId,
          status: "blocked-rate-limit",
          scope: rateLimitDecision.scope,
          key: rateLimitDecision.key,
          limit: rateLimitDecision.limit,
          remaining: rateLimitDecision.remaining,
          retryAfterMs: rateLimitDecision.retryAfterMs,
          input: inputSummary
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  blocked: true,
                  code: "rate_limited",
                  httpStatus: 429,
                  scope: rateLimitDecision.scope,
                  key: rateLimitDecision.key,
                  limit: rateLimitDecision.limit,
                  remaining: rateLimitDecision.remaining,
                  retryAfterMs: rateLimitDecision.retryAfterMs
                },
                null,
                2
              )
            }
          ]
        };
      }

      if (isCostBudgetEnforcerEnabled()) {
        const config = await costBudget.loadConfig();
        const estimate = buildCostUsageFromInputOutput({
          inputSummary,
          outputRatio: config.outputTokenRatio
        });
        const budgetCheck = await costBudget.assertWithin({
          toolName: name,
          traceId,
          actorId: actor.id,
          tenantId: actor.tenantId,
          sessionId,
          model: modelName,
          inputTokens: estimate.inputTokens,
          outputTokens: estimate.outputTokens
        });
        if (!budgetCheck.allowed) {
          const usdEstimate = costBudget.estimateUsd(modelName, estimate.inputTokens, estimate.outputTokens);
          await costBudget.recordUsage({
            ts: new Date().toISOString(),
            toolName: name,
            traceId,
            actorId: actor.id,
            tenantId: actor.tenantId,
            sessionId,
            model: modelName,
            inputTokens: estimate.inputTokens,
            outputTokens: estimate.outputTokens,
            usdEstimate,
            status: "blocked",
            reason: budgetCheck.reason
          });
          void import("../observability/prometheus-metrics.js")
            .then((m) => m.recordCostBudgetForPrometheus({
              actorId: actor.id,
              tenantId: actor.tenantId,
              model: modelName,
              usd: usdEstimate,
              toolName: name,
              exceeded: true
            }))
            .catch(() => {});
          await emitSystemEvent("tool_after_execute", {
            toolName: name,
            traceId,
            success: false,
            blockedByBudget: true,
            reason: budgetCheck.reason,
            code: "budget_exceeded"
          });
          endTrace(traceId, { blockedByBudget: true, reason: budgetCheck.reason });
          recordMetric({
            toolName: name,
            traceId,
            startedAt: startedAt.toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
            status: "error"
          });
          await appendToolAudit({
            toolName: name,
            traceId,
            status: "blocked-budget",
            reason: budgetCheck.reason,
            projectedUsd: budgetCheck.projectedUsd,
            projectedTokens: budgetCheck.projectedTokens,
            input: inputSummary
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  blocked: true,
                  code: "budget_exceeded",
                  httpStatus: 429,
                  reason: budgetCheck.reason,
                  projectedUsd: budgetCheck.projectedUsd,
                  projectedTokens: budgetCheck.projectedTokens
                }, null, 2)
              }
            ]
          };
        }
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
          const execution = await toolRecorder.execute({
            toolName: name,
            input,
            sessionId,
            handler: () => handler(input as TInput)
          });
          const result = execution.result;
          const outputSummary = summarizeValue(result);
          if (isCostBudgetEnforcerEnabled()) {
            const config = await costBudget.loadConfig();
            const usage = buildCostUsageFromInputOutput({
              inputSummary,
              outputSummary,
              outputRatio: config.outputTokenRatio
            });
            const usdEstimate = costBudget.estimateUsd(modelName, usage.inputTokens, usage.outputTokens);
            await costBudget.recordUsage({
              ts: new Date().toISOString(),
              toolName: name,
              traceId,
              actorId: actor.id,
              tenantId: actor.tenantId,
              sessionId,
              model: modelName,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              usdEstimate,
              status: "success"
            });
            void import("../observability/prometheus-metrics.js")
              .then((m) => m.recordCostBudgetForPrometheus({
                actorId: actor.id,
                tenantId: actor.tenantId,
                model: modelName,
                usd: usdEstimate,
                toolName: name
              }))
              .catch(() => {});
          }
          await emitSystemEvent("tool_after_execute", {
            toolName: name,
            traceId,
            success: true,
            contentCount: Array.isArray(result?.content) ? result.content.length : 0,
            replayed: execution.replayed,
            replayMode: execution.mode,
            argsHash: execution.argsHash,
            attempts: attempt + 1,
            retried: attempt > 0
          });
          endTrace(traceId, {
            success: true,
            attempts: attempt + 1,
            replayed: execution.replayed,
            replayMode: execution.mode,
            argsHash: execution.argsHash
          });
          void import("../observability/otel-tracer.js")
            .then((m) => m.notifyOtelTraceEnd(traceId, { "sfai.attempts": attempt + 1 }))
            .catch(() => {});
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
            inputSummary,
            outputSummary,
            "success"
          );
          recordExecutionOrigin(name, input, "success");
          await appendToolAudit({
            toolName: name,
            traceId,
            status: "success",
            replayed: execution.replayed,
            replayMode: execution.mode,
            argsHash: execution.argsHash,
            attempts: attempt + 1,
            input: inputSummary,
            output: outputSummary
          });
          // Save bandit state after successful tool execution
          try {
            await saveBanditState(getBanditState(), banditStateFile);
          } catch (saveError) {
            // Bandit state save failure should not block tool execution
            void emitSystemEvent("bandit_state_save_failed", {
              toolName: name,
              traceId,
              error: summarizeValue(saveError, 200)
            }).catch(() => {});
          }
          return attachProgressBanner(name, traceId, result);
        } catch (error) {
          const retryable = retryConfig.retryEnabled && (
            isRetryableError(error, patterns) || isRetryableByCode(error, retryableCodes)
          );
          if (!retryable || attempt >= maxRetries) {
            const errorSummary = summarizeValue(error, 500);
            if (isCostBudgetEnforcerEnabled()) {
              const config = await costBudget.loadConfig();
              const usage = buildCostUsageFromInputOutput({
                inputSummary,
                outputSummary: errorSummary,
                outputRatio: config.outputTokenRatio
              });
              const usdEstimate = costBudget.estimateUsd(modelName, usage.inputTokens, usage.outputTokens);
              await costBudget.recordUsage({
                ts: new Date().toISOString(),
                toolName: name,
                traceId,
                actorId: actor.id,
                tenantId: actor.tenantId,
                sessionId,
                model: modelName,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                usdEstimate,
                status: "error"
              });
              void import("../observability/prometheus-metrics.js")
                .then((m) => m.recordCostBudgetForPrometheus({
                  actorId: actor.id,
                  tenantId: actor.tenantId,
                  model: modelName,
                  usd: usdEstimate,
                  toolName: name
                }))
                .catch(() => {});
            }
            await emitSystemEvent("tool_after_execute", {
              toolName: name,
              traceId,
              success: false,
              replayMode: getReplayMode(),
              error: errorSummary,
              attempts: attempt + 1,
              retried: attempt > 0
            });
            await registerToolFailure(name, error);
            failTrace(traceId, error);
            void import("../observability/otel-tracer.js")
              .then((m) => m.notifyOtelTraceFail(traceId, error))
              .catch(() => {});
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
              inputSummary,
              errorSummary,
              "error"
            );
            recordExecutionOrigin(name, input, "error");
            await appendToolAudit({
              toolName: name,
              traceId,
              status: "error",
              replayMode: getReplayMode(),
              attempts: attempt + 1,
              input: inputSummary,
              error: errorSummary
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
    });
  }

  return { govTool };
}

