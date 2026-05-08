/**
 * .env 読込ローダ (副作用 import 専用)。
 *
 * - 必ず他のすべての import より前に import すること。
 * - `dotenv` を利用。
 * - 既に OS 環境変数で設定されているキーは上書きしない (`override: false`)。
 * - 探索順:
 *   1. `SF_AI_DOTENV_PATH` (絶対パス推奨)
 *   2. `<cwd>/.env`
 *   3. このファイルの位置から上方向に最大 6 階層辿り、最初に見つかった `.env`
 *      (tsx 実行: mcp/env-loader.ts → リポジトリルート / 本番ビルド: dist/mcp/env-loader.js → リポジトリルート の両方をカバー)
 * - `SF_AI_DOTENV_DISABLE=1` で完全無効化。
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyRuntimeProfile } from "./core/config/runtime-profile.js";
import { validateEnvironment } from "./env-schema.js";
import { hydrateEnvFromSecrets } from "./core/security/secrets.js";

function findUpwards(startDir: string, target: string, maxDepth = 6): string | undefined {
  let current = startDir;
  for (let i = 0; i < maxDepth; i++) {
    const candidate = resolve(current, target);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

function parseSecretMap(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [envKey, secretName] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof secretName === "string" && secretName.trim().length > 0) {
        out[envKey] = secretName.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function hydrateSecretsIntoEnv(): Promise<void> {
  const bootstrapEnabled = (process.env.SF_AI_SECRET_BOOTSTRAP ?? "true").toLowerCase() !== "false";
  if (!bootstrapEnabled) {
    return;
  }

  const backend = (process.env.SF_AI_SECRET_BACKEND ?? "env").trim();
  const extraMap = parseSecretMap(process.env.SF_AI_SECRET_ENV_MAP);

  if (backend === "env" && Object.keys(extraMap).length === 0) {
    return;
  }

  const map: Record<string, string> = {
    SF_AI_ENCRYPTION_KEY_B64: process.env.SF_AI_ENCRYPTION_KEY_SECRET_NAME ?? "",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY_SECRET_NAME ?? "",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY_SECRET_NAME ?? "",
    LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY_SECRET_NAME ?? "",
    ...extraMap,
  };

  const { loaded, failed } = await hydrateEnvFromSecrets(map);
  if ((process.env.LOG_LEVEL ?? "info") !== "error") {
    if (loaded.length > 0) {
      process.stderr.write(`[INFO][EnvLoader] hydrated secrets: ${loaded.join(", ")}\n`);
    }
    if (failed.length > 0) {
      process.stderr.write(
        `[WARN][EnvLoader] secret hydration failed for keys: ${failed.map((v) => v.envKey).join(", ")}\n`,
      );
    }
  }
}

if ((process.env.SF_AI_DOTENV_DISABLE ?? "").toLowerCase() !== "1") {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates: Array<string | undefined> = [];
  if (process.env.SF_AI_DOTENV_PATH) {
    candidates.push(process.env.SF_AI_DOTENV_PATH);
  }
  candidates.push(resolve(process.cwd(), ".env"));
  candidates.push(findUpwards(here, ".env"));

  const found = candidates.find((path): path is string => typeof path === "string" && existsSync(path));
  if (found) {
    try {
      loadDotenv({ path: found, override: false });
      const applied = applyRuntimeProfile(process.env);
      // info ログは logger 経由ではなく stderr に直接 (この時点で logger は未初期化のことがあるため)
      if ((process.env.LOG_LEVEL ?? "info") !== "error") {
        process.stderr.write(`[INFO][EnvLoader] .env loaded from ${found}\n`);
        if (applied.profile !== "custom") {
          process.stderr.write(`[INFO][EnvLoader] runtime profile applied: ${applied.profile}\n`);
          if (applied.overridden.length > 0) {
            process.stderr.write(`[INFO][EnvLoader] profile override keys: ${applied.overridden.join(", ")}\n`);
          }
        }
      }
    } catch (error) {
      process.stderr.write(`[WARN][EnvLoader] Failed to load .env: ${String(error)}\n`);
    }
  }
}

await hydrateSecretsIntoEnv();

const shouldValidateEnv = (process.env.SF_AI_ENV_VALIDATE ?? "true").toLowerCase() !== "false";
if (shouldValidateEnv) {
  validateEnvironment(process.env);
}
