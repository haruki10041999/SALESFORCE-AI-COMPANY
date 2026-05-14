import type { LlmCacheStorePort } from "../../core/ports/llm-cache-port.js";
import type { CompletionRequest, CompletionResult, LlmCompletionPort } from "../../core/ports/llm-completion-port.js";
import { buildLlmCacheKey } from "./llm-cache-postgres.js";

export interface CachedCompletionPortOptions {
  replayMode?: "observe" | "strict";
  requireCacheHit?: boolean;
  adapterName?: string;
  adapterVersion?: string;
}

function toCacheParams(req: CompletionRequest): Record<string, unknown> {
  return {
    model: req.model ?? null,
    temperature: req.temperature ?? null,
    maxTokens: req.maxTokens ?? null,
    metadata: req.metadata ?? {}
  };
}

export function createCachedCompletionPort(
  base: LlmCompletionPort,
  cacheStore: LlmCacheStorePort,
  options: CachedCompletionPortOptions = {}
): LlmCompletionPort {
  const replayMode = options.replayMode ?? "observe";
  const adapterName = options.adapterName ?? "agent-chat-fallback";
  const adapterVersion = options.adapterVersion ?? "v1";
  const requireCacheHit = options.requireCacheHit ?? replayMode === "strict";

  return {
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const { cacheKey, promptHash, paramsHash } = buildLlmCacheKey({
        prompt: req.prompt,
        adapter: adapterName,
        version: adapterVersion,
        params: toCacheParams(req)
      });

      const hit = await cacheStore.get({ cacheKey });
      if (hit) {
        return {
          text: hit.outputText,
          model: hit.model ?? req.model,
          usage: hit.usage,
          metadata: {
            ...(req.metadata ?? {}),
            ...(hit.metadata ?? {}),
            cacheHit: true,
            cacheKey,
            replayMode
          }
        };
      }

      if (requireCacheHit) {
        throw new Error(`Replay strict mode requires cache hit (cacheKey=${cacheKey})`);
      }

      const response = await base.complete(req);
      await cacheStore.set({
        cacheKey,
        promptHash,
        adapter: adapterName,
        version: adapterVersion,
        model: response.model ?? req.model,
        paramsHash,
        outputText: response.text,
        usage: response.usage,
        metadata: {
          ...(req.metadata ?? {}),
          ...(response.metadata ?? {}),
          replayMode,
          cacheHit: false
        }
      });

      return {
        ...response,
        metadata: {
          ...(response.metadata ?? {}),
          cacheHit: false,
          cacheKey,
          replayMode
        }
      };
    }
  };
}
