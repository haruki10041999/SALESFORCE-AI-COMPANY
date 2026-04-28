/**
 * T-OLLAMA-01: Ollama HTTP Client
 *
 * ローカル Ollama サーバ (既定 http://localhost:11434) と通信するための
 * stateless な fetch ラッパ。retry / timeout / health check を提供する。
 *
 * - 副作用は HTTP 呼び出しのみ。グローバル状態を持たない。
 * - 失敗時は `OllamaError` を throw し、呼び出し側でフォールバックを判断する。
 * - 上位の `EmbeddingProvider` (T-OLLAMA-02) や judge 機能から再利用される。
 */

export interface OllamaClientConfig {
  /** ベース URL。既定: http://localhost:11434 */
  baseUrl?: string;
  /** リクエストタイムアウト ms。既定: 30000 */
  timeoutMs?: number;
  /** リトライ回数 (本リクエストを除く)。既定: 1 */
  maxRetries?: number;
  /** リトライ間ベース待機 ms。既定: 200 */
  retryBaseDelayMs?: number;
  /** カスタム fetch 実装 (テスト用) */
  fetchImpl?: typeof fetch;
}

export interface OllamaErrorOptions {
  status?: number;
  cause?: unknown;
  retriable?: boolean;
}

export class OllamaError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retriable: boolean;
  readonly cause?: unknown;

  constructor(code: string, message: string, options: OllamaErrorOptions = {}) {
    super(message);
    this.name = "OllamaError";
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.cause !== undefined) this.cause = options.cause;
    this.retriable = options.retriable ?? false;
  }
}

export interface OllamaEmbeddingsRequest {
  model: string;
  prompt: string;
}

export interface OllamaEmbeddingsResponse {
  embedding: number[];
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  /** false の場合に単一レスポンスを返す。true は generateStream() を使う */
  stream?: false;
  /** モデル動作オプション (temperature 等) */
  options?: Record<string, unknown>;
  /** system prompt (option) */
  system?: string;
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  eval_count?: number;
}

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream?: false;
  options?: Record<string, unknown>;
}

export interface OllamaChatResponse {
  model: string;
  message: OllamaChatMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  eval_count?: number;
}

/** T-OLLAMA-03: ストリーム generate の 1 チャンク */
export interface OllamaGenerateChunk {
  /** モデル名 */
  model: string;
  /** 累積ではない、このチャンクで追加されたテキスト */
  response: string;
  /** 最終チャンクは true */
  done: boolean;
  /** done=true の最終チャンクで返るメタ */
  total_duration?: number;
  eval_count?: number;
}

export interface OllamaTagsResponse {
  models: Array<{
    name: string;
    modified_at: string;
    size: number;
  }>;
}

const DEFAULTS = {
  baseUrl: "http://localhost:11434",
  timeoutMs: 30000,
  maxRetries: 1,
  retryBaseDelayMs: 200
} as const;

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OllamaClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULTS.baseUrl).replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxRetries = config.maxRetries ?? DEFAULTS.maxRetries;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? DEFAULTS.retryBaseDelayMs;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /** /api/tags を叩いて生存確認。タイムアウト超過は false を返す (throw しない) */
  public async health(): Promise<{ ok: boolean; models: string[]; error?: string }> {
    try {
      const tags = await this.listModels();
      return { ok: true, models: tags.models.map((m) => m.name) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, models: [], error: message };
    }
  }

  public async listModels(): Promise<OllamaTagsResponse> {
    return await this.requestJson<OllamaTagsResponse>("GET", "/api/tags");
  }

  public async embeddings(req: OllamaEmbeddingsRequest): Promise<OllamaEmbeddingsResponse> {
    if (!req.model) throw new OllamaError("E_OLLAMA_BAD_REQUEST", "model is required");
    const body = await this.requestJson<OllamaEmbeddingsResponse>("POST", "/api/embeddings", {
      model: req.model,
      prompt: req.prompt
    });
    if (!Array.isArray(body.embedding) || body.embedding.length === 0) {
      throw new OllamaError("E_OLLAMA_EMPTY_EMBEDDING", "ollama returned empty embedding", {
        retriable: true
      });
    }
    return body;
  }

  public async generate(req: OllamaGenerateRequest): Promise<OllamaGenerateResponse> {
    if (!req.model) throw new OllamaError("E_OLLAMA_BAD_REQUEST", "model is required");
    return await this.requestJson<OllamaGenerateResponse>("POST", "/api/generate", {
      ...req,
      stream: false
    });
  }

  public async chat(req: OllamaChatRequest): Promise<OllamaChatResponse> {
    if (!req.model) throw new OllamaError("E_OLLAMA_BAD_REQUEST", "model is required");
    if (!Array.isArray(req.messages) || req.messages.length === 0) {
      throw new OllamaError("E_OLLAMA_BAD_REQUEST", "messages is required");
    }
    return await this.requestJson<OllamaChatResponse>("POST", "/api/chat", {
      ...req,
      stream: false
    });
  }

  /**
   * T-OLLAMA-03: NDJSON ストリームで /api/generate を呼ぶ。
   * リトライは行わず (チャンク済を捨てるリスク)、タイムアウト/ネットワークエラーは {@link OllamaError} で throw。
   * `onChunk` が指定されていれば each chunk に対して同期的に呼び出す (chat 表示の incremental flush 用)。
   * 戻り値は累積レスポンス + 最終 done メタ。
   */
  public async generateStream(
    req: Omit<OllamaGenerateRequest, "stream">,
    onChunk?: (chunk: OllamaGenerateChunk) => void
  ): Promise<OllamaGenerateResponse> {
    if (!req.model) throw new OllamaError("E_OLLAMA_BAD_REQUEST", "model is required");
    const url = `${this.baseUrl}/api/generate`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...req, stream: true })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new OllamaError(
          `E_OLLAMA_HTTP_${res.status}`,
          `Ollama HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
          { status: res.status, retriable: isRetriableStatus(res.status) }
        );
      }
      if (!res.body) {
        throw new OllamaError("E_OLLAMA_NETWORK", "stream response missing body");
      }

      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let aggregate = "";
      let lastChunk: OllamaGenerateChunk | null = null;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line.length === 0) continue;
          try {
            const json = JSON.parse(line) as OllamaGenerateChunk;
            aggregate += json.response ?? "";
            lastChunk = json;
            if (onChunk) onChunk(json);
            if (json.done) break;
          } catch {
            // 部分行の途中で改行がない場合に備え、無効行は読み飛ばす
          }
        }
      }
      const final: OllamaGenerateResponse = {
        model: lastChunk?.model ?? req.model,
        response: aggregate,
        done: true,
        ...(lastChunk?.total_duration !== undefined ? { total_duration: lastChunk.total_duration } : {}),
        ...(lastChunk?.eval_count !== undefined ? { eval_count: lastChunk.eval_count } : {})
      };
      return final;
    } catch (err) {
      if (err instanceof OllamaError) throw err;
      const isAbort = (err as { name?: string } | null)?.name === "AbortError";
      throw new OllamaError(
        isAbort ? "E_OLLAMA_TIMEOUT" : "E_OLLAMA_NETWORK",
        isAbort
          ? `Ollama stream timed out after ${this.timeoutMs}ms`
          : `Ollama stream network error: ${(err as Error)?.message ?? String(err)}`,
        { cause: err, retriable: true }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestJson<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastError: unknown;
    const totalAttempts = this.maxRetries + 1;

    for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const init: RequestInit = {
          method,
          signal: controller.signal,
          headers: body !== undefined ? { "content-type": "application/json" } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined
        };
        const res = await this.fetchImpl(url, init);
        clearTimeout(timer);

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const retriable = isRetriableStatus(res.status);
          const error = new OllamaError(
            `E_OLLAMA_HTTP_${res.status}`,
            `Ollama HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
            { status: res.status, retriable }
          );
          if (retriable && attempt < totalAttempts - 1) {
            lastError = error;
            await delay(this.retryBaseDelayMs * Math.pow(2, attempt));
            continue;
          }
          throw error;
        }

        return (await res.json()) as T;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof OllamaError) throw err;

        // AbortError or network error
        const isAbort = (err as { name?: string } | null)?.name === "AbortError";
        const code = isAbort ? "E_OLLAMA_TIMEOUT" : "E_OLLAMA_NETWORK";
        const retriable = true;
        const wrapped = new OllamaError(
          code,
          isAbort ? `Ollama request timed out after ${this.timeoutMs}ms` : `Ollama network error: ${(err as Error)?.message ?? String(err)}`,
          { cause: err, retriable }
        );
        if (attempt < totalAttempts - 1) {
          lastError = wrapped;
          await delay(this.retryBaseDelayMs * Math.pow(2, attempt));
          continue;
        }
        throw wrapped;
      }
    }
    // unreachable, but keeps TS happy
    throw (lastError as Error) ?? new OllamaError("E_OLLAMA_UNKNOWN", "unknown ollama error");
  }
}

/** プロセス全体で再利用するシングルトン。設定は env から解決される */
let DEFAULT_CLIENT: OllamaClient | null = null;

export interface OllamaEnvSource {
  OLLAMA_BASE_URL?: string;
  OLLAMA_TIMEOUT_MS?: string;
}

export function buildOllamaClientFromEnv(env: OllamaEnvSource = process.env): OllamaClient {
  const timeout = env.OLLAMA_TIMEOUT_MS ? Number.parseInt(env.OLLAMA_TIMEOUT_MS, 10) : undefined;
  return new OllamaClient({
    baseUrl: env.OLLAMA_BASE_URL,
    timeoutMs: Number.isFinite(timeout) && timeout! > 0 ? timeout : undefined
  });
}

export function getDefaultOllamaClient(): OllamaClient {
  if (!DEFAULT_CLIENT) DEFAULT_CLIENT = buildOllamaClientFromEnv();
  return DEFAULT_CLIENT;
}

/** テスト用にシングルトンを差し替える */
export function _setDefaultOllamaClient(client: OllamaClient | null): void {
  DEFAULT_CLIENT = client;
}
