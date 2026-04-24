/**
 * .env 読込ローダ (副作用 import 専用)。
 *
 * - 必ず他のすべての import より前に import すること。
 * - Node.js 20.6+ の `process.loadEnvFile` を利用。
 * - 既に OS 環境変数で設定されているキーは上書きしない (loadEnvFile 既定動作)。
 * - 探索順:
 *   1. `SF_AI_DOTENV_PATH` (絶対パス推奨)
 *   2. `<cwd>/.env`
 *   3. このファイルの位置から上方向に最大 6 階層辿り、最初に見つかった `.env`
 *      (tsx 実行: mcp/env-loader.ts → リポジトリルート / 本番ビルド: dist/mcp/env-loader.js → リポジトリルート の両方をカバー)
 * - `SF_AI_DOTENV_DISABLE=1` で完全無効化。
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
      const loader = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
      if (typeof loader === "function") {
        loader.call(process, found);
      }
      // info ログは logger 経由ではなく stderr に直接 (この時点で logger は未初期化のことがあるため)
      if ((process.env.LOG_LEVEL ?? "info") !== "error") {
        process.stderr.write(`[INFO][EnvLoader] .env loaded from ${found}\n`);
      }
    } catch (error) {
      process.stderr.write(`[WARN][EnvLoader] Failed to load .env: ${String(error)}\n`);
    }
  }
}
