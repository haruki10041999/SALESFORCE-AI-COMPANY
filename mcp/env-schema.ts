import { z } from "zod";
import { resolveRuntimeProfile } from "./core/config/runtime-profile.js";

const stateBackendSchema = z.enum(["sqlite", "postgres", "memory"]);
const proposalQueueBackendSchema = z.enum(["file", "pg-boss", "memory"]);
const vectorBackendSchema = z.enum(["tfidf", "pgvector", "memory"]);
const workflowEngineSchema = z.enum(["in-process", "temporal"]);
const embeddingProviderSchema = z.enum(["ollama", "openai", "cohere", "ngram"]);
const eventBusBackendSchema = z.enum(["in-memory", "postgres-notify", "redis-streams"]);
const secretBackendSchema = z.enum(["env", "file", "vault", "aws-sm"]);
const mcpTransportSchema = z.enum(["stdio", "http"]);
const runtimeProfileSchema = z.enum(["local", "operations", "custom"]);
const envModeSchema = z.enum(["dev", "prod"]);

function optionalNonEmptyString() {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    },
    z.string().min(1).optional()
  );
}

export type EnvMode = z.infer<typeof envModeSchema>;

const envSchema = z
  .object({
    SF_AI_ENV_MODE: envModeSchema.optional(),
    SF_AI_PROFILE: runtimeProfileSchema.optional(),
    SF_AI_RUNTIME_PROFILE: runtimeProfileSchema.optional(),
    SF_AI_STATE_BACKEND: stateBackendSchema.optional(),
    SF_AI_PROPOSAL_QUEUE_BACKEND: proposalQueueBackendSchema.optional(),
    SF_AI_VECTOR_BACKEND: vectorBackendSchema.optional(),
    SF_AI_WORKFLOW_ENGINE: workflowEngineSchema.optional(),
    SF_AI_TEMPORAL_ADDRESS: optionalNonEmptyString(),
    SF_AI_TEMPORAL_NAMESPACE: optionalNonEmptyString(),
    SF_AI_TEMPORAL_TASK_QUEUE: optionalNonEmptyString(),
    SF_AI_TEMPORAL_RUN_WORKER: z.enum(["true", "false", "1", "0"]).optional(),
    SF_AI_TEMPORAL_WORKFLOW_RETRY_MAX_ATTEMPTS: optionalNonEmptyString(),
    SF_AI_TEMPORAL_ACTIVITY_TIMEOUT_SECONDS: optionalNonEmptyString(),
    SF_AI_TEMPORAL_ACTIVITY_RETRY_MAX_ATTEMPTS: optionalNonEmptyString(),
    SF_AI_TEMPORAL_ACTIVITY_RETRY_INITIAL_INTERVAL_MS: optionalNonEmptyString(),
    SF_AI_TEMPORAL_ACTIVITY_RETRY_BACKOFF_COEFFICIENT: optionalNonEmptyString(),
    SF_AI_EMBEDDING_PROVIDER: embeddingProviderSchema.optional(),
    SF_AI_CRITIC_JUDGE_TARGET_SCORE: optionalNonEmptyString(),
    SF_AI_CRITIC_HEURISTIC_TARGET_SCORE: optionalNonEmptyString(),
    SF_AI_CRITIC_PROPOSAL_SCORE_THRESHOLD: optionalNonEmptyString(),
    SF_AI_CRITIC_MIN_IMPROVEMENT_THRESHOLD: optionalNonEmptyString(),
    SF_AI_EVENT_BUS_BACKEND: eventBusBackendSchema.optional(),
    SF_AI_EVENT_BUS_REDIS_URL: optionalNonEmptyString(),
    SF_AI_EVENT_BUS_STREAM_KEY: optionalNonEmptyString(),
    SF_AI_SECRET_BACKEND: secretBackendSchema.optional(),
    // Embedding API keys
    OPENAI_API_KEY: optionalNonEmptyString(),
    OPENAI_EMBEDDING_MODEL: optionalNonEmptyString(),
    COHERE_API_KEY: optionalNonEmptyString(),
    COHERE_EMBEDDING_MODEL: optionalNonEmptyString(),
    MCP_TRANSPORT: mcpTransportSchema.optional(),
    MCP_HTTP_HOST: optionalNonEmptyString(),
    MCP_HTTP_PORT: optionalNonEmptyString(),
    MCP_HTTP_CORS_ORIGIN: optionalNonEmptyString(),
    MCP_HTTP_RATE_LIMIT_PER_MIN: optionalNonEmptyString(),
    SF_AI_PROFILE_STRICT: z.enum(["true", "false", "1", "0"]).optional(),
    SF_AI_DOTENV_DISABLE: z.enum(["1", "0"]).optional(),
    // Observability: OpenTelemetry
    OTEL_ENABLED: z.enum(["true", "false", "1", "0"]).optional(),
    OTEL_SERVICE_NAME: optionalNonEmptyString(),
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalNonEmptyString(),
    OTEL_TRACES_SAMPLER_RATIO: optionalNonEmptyString(), // 0.0-1.0, default 0.1 (10%)
    OTEL_PII_REDACTION_ENABLED: z.enum(["true", "false", "1", "0"]).optional(), // default: true
    DATABASE_URL: optionalNonEmptyString(),
    SF_AI_VAULT_ADDR: optionalNonEmptyString(),
    SF_AI_VAULT_AUTH_VALUE: optionalNonEmptyString(),
  })
  .passthrough()
  .superRefine((env, ctx) => {
    if (env.SF_AI_STATE_BACKEND === "postgres" && !env.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "SF_AI_STATE_BACKEND=postgres の場合は DATABASE_URL が必要です",
      });
    }

    if (env.SF_AI_SECRET_BACKEND === "vault") {
      if (!env.SF_AI_VAULT_ADDR) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SF_AI_VAULT_ADDR"],
          message: "SF_AI_SECRET_BACKEND=vault の場合は SF_AI_VAULT_ADDR が必要です",
        });
      }
      if (!env.SF_AI_VAULT_AUTH_VALUE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SF_AI_VAULT_AUTH_VALUE"],
          message: "SF_AI_SECRET_BACKEND=vault の場合は SF_AI_VAULT_AUTH_VALUE が必要です",
        });
      }
    }
  });

export function resolveEnvMode(env: NodeJS.ProcessEnv = process.env): EnvMode {
  const mode = env.SF_AI_ENV_MODE?.trim().toLowerCase();
  if (mode === "dev" || mode === "prod") {
    return mode;
  }

  const profile = resolveRuntimeProfile(env.SF_AI_PROFILE ?? env.SF_AI_RUNTIME_PROFILE);
  if (profile === "operations") {
    return "prod";
  }

  if ((env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    return "prod";
  }

  return "dev";
}

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): {
  mode: EnvMode;
  data: NodeJS.ProcessEnv;
} {
  const mode = resolveEnvMode(env);
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const key = issue.path.join(".") || "<env>";
        return `${key}: ${issue.message}`;
      })
      .join("; ");
    throw new Error(`Environment validation failed (${mode}): ${issues}`);
  }
  return { mode, data: result.data as NodeJS.ProcessEnv };
}
