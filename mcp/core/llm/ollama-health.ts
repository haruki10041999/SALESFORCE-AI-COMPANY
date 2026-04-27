/**
 * T-OLLAMA-05: Ollama health check + fallback orchestration
 *
 * サーバ起動時 / 機能利用時に Ollama の可用性を判定し、`OLLAMA_REQUIRED` に応じて
 * 起動を中断するか ngram 等のフォールバックへ切り替えるかを決める純粋ロジック。
 *
 * - 副作用は内部キャッシュの更新のみ。bootstrap 側からの呼び出しを想定。
 * - LLM 呼び出しは {@link OllamaClient} を介して行う。本モジュールは結果を解釈する役割。
 */

import { OllamaClient, getDefaultOllamaClient } from "./ollama-client.js";

export type OllamaAvailability =
  | { status: "available"; models: string[]; checkedAt: number }
  | { status: "unavailable"; reason: string; checkedAt: number };

export interface OllamaHealthOptions {
  /** カスタムクライアント。未指定時はデフォルトクライアント */
  client?: OllamaClient;
  /** キャッシュ TTL ms。既定: 30000。`force=true` で無視 */
  cacheTtlMs?: number;
  /** キャッシュを無視して再チェック */
  force?: boolean;
  /** 必要最低限のモデル名 (Embedding / judge)。指定時、不足ならば unavailable 扱い */
  requiredModels?: string[];
}

const DEFAULT_TTL_MS = 30000;

let CACHED: OllamaAvailability | null = null;

export function _resetOllamaHealthCache(): void {
  CACHED = null;
}

export async function checkOllamaAvailability(options: OllamaHealthOptions = {}): Promise<OllamaAvailability> {
  const ttl = options.cacheTtlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();
  if (!options.force && CACHED && now - CACHED.checkedAt < ttl) {
    return CACHED;
  }

  const client = options.client ?? getDefaultOllamaClient();
  const result = await client.health();
  if (!result.ok) {
    CACHED = { status: "unavailable", reason: result.error ?? "unknown", checkedAt: now };
    return CACHED;
  }

  // 必須モデル不足チェック
  if (options.requiredModels && options.requiredModels.length > 0) {
    const missing = options.requiredModels.filter((m) => !result.models.some((avail) => avail.startsWith(m)));
    if (missing.length > 0) {
      CACHED = {
        status: "unavailable",
        reason: `required models missing: ${missing.join(", ")}`,
        checkedAt: now
      };
      return CACHED;
    }
  }

  CACHED = { status: "available", models: result.models, checkedAt: now };
  return CACHED;
}

export interface OllamaPolicyEnvSource {
  OLLAMA_REQUIRED?: string;
  EMBEDDING_PROVIDER?: string;
  OLLAMA_EMBEDDING_MODEL?: string;
  OLLAMA_JUDGE_MODEL?: string;
}

export interface OllamaPolicy {
  /** OLLAMA_REQUIRED=true の場合 true */
  required: boolean;
  /** EmbeddingProvider 設定 ("ngram" | "ollama")。既定: "ngram" */
  embeddingProvider: "ngram" | "ollama";
  /** Embedding 用 Ollama モデル */
  embeddingModel: string;
  /** Judge 用 Ollama モデル */
  judgeModel: string;
}

export function readOllamaPolicy(env: OllamaPolicyEnvSource = process.env): OllamaPolicy {
  const required = (env.OLLAMA_REQUIRED ?? "").toLowerCase() === "true";
  const provider = (env.EMBEDDING_PROVIDER ?? "ngram").toLowerCase();
  const embeddingProvider: "ngram" | "ollama" = provider === "ollama" ? "ollama" : "ngram";
  return {
    required,
    embeddingProvider,
    embeddingModel: env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text",
    judgeModel: env.OLLAMA_JUDGE_MODEL ?? "qwen2.5:3b"
  };
}

export type FallbackDecision =
  | { kind: "use-ollama"; models: string[] }
  | { kind: "fallback-ngram"; reason: string }
  | { kind: "abort-startup"; reason: string };

/**
 * 可用性 + ポリシーから起動時の挙動を決める。
 * - required=true で unavailable -> abort-startup
 * - provider=ollama で unavailable -> fallback-ngram (warning)
 * - provider=ollama で available  -> use-ollama
 * - provider=ngram               -> fallback-ngram (info)
 */
export function decideFallback(
  policy: OllamaPolicy,
  availability: OllamaAvailability
): FallbackDecision {
  if (availability.status === "unavailable") {
    if (policy.required) {
      return { kind: "abort-startup", reason: availability.reason };
    }
    return { kind: "fallback-ngram", reason: availability.reason };
  }
  if (policy.embeddingProvider === "ollama") {
    return { kind: "use-ollama", models: availability.models };
  }
  return { kind: "fallback-ngram", reason: "EMBEDDING_PROVIDER=ngram" };
}

/**
 * bootstrap 用の高レベル関数。policy 読み取り + health check + 判定をまとめて返す。
 */
export async function evaluateOllamaStartup(
  options: { env?: OllamaPolicyEnvSource; client?: OllamaClient; force?: boolean } = {}
): Promise<{ policy: OllamaPolicy; availability: OllamaAvailability; decision: FallbackDecision }> {
  const policy = readOllamaPolicy(options.env ?? process.env);
  const requiredModels =
    policy.embeddingProvider === "ollama" ? [policy.embeddingModel] : [];
  const healthOptions: OllamaHealthOptions = { requiredModels };
  if (options.client !== undefined) healthOptions.client = options.client;
  if (options.force !== undefined) healthOptions.force = options.force;
  const availability = await checkOllamaAvailability(healthOptions);
  const decision = decideFallback(policy, availability);
  return { policy, availability, decision };
}
