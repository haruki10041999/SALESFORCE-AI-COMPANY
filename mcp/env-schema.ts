import { z } from "zod";
import { resolveRuntimeProfile } from "./core/config/runtime-profile.js";

const stateBackendSchema = z.enum(["sqlite", "postgres", "memory"]);
const proposalQueueBackendSchema = z.enum(["file", "pg-boss", "memory"]);
const vectorBackendSchema = z.enum(["tfidf", "pgvector", "memory"]);
const secretBackendSchema = z.enum(["env", "file", "vault", "aws-sm"]);
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
    SF_AI_SECRET_BACKEND: secretBackendSchema.optional(),
    SF_AI_PROFILE_STRICT: z.enum(["true", "false", "1", "0"]).optional(),
    SF_AI_DOTENV_DISABLE: z.enum(["1", "0"]).optional(),
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
