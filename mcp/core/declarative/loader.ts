/**
 * Declarative tool loader.
 *
 * `outputs/custom-tools/*.json` (または任意ディレクトリ) を読み、`DeclarativeToolSpec` に
 * 解釈して `govTool` で動的登録する。
 *
 * - 同名重複は最初の一件を採用 (loader は idempotent)
 * - parse 失敗ファイルは `skipped` として返却 (例外を上位に投げない)
 * - I/O は本モジュールに閉じ、登録ロジックは pure な dispatcher 関数で記述
 */

import { existsSync, promises as fsPromises } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { GovTool } from "../../tool-types.js";
import {
  parseToolSpec,
  type DeclarativeToolSpec,
  type DeclarativeToolAction
} from "./tool-spec.js";

export interface DeclarativeToolLoaderDeps {
  govTool: GovTool;
  /** compose-prompt action 用。register-all-tools が渡す既存 buildChatPrompt をそのまま使う。 */
  buildChatPrompt: (
    topic: string,
    agents: string[],
    persona?: string,
    skills?: string[],
    filePaths?: string[],
    turns?: number,
    maxContextChars?: number,
    appendInstruction?: string
  ) => Promise<string>;
  filterDisabledSkills: (skills: string[]) => Promise<{ enabled: string[]; disabled: string[] }>;
}

export interface LoadResult {
  registered: string[];
  skipped: Array<{ file: string; reason: string }>;
}

/**
 * action を実行ハンドラに変換する純粋ファクトリ。
 */
export function buildHandler(
  spec: DeclarativeToolSpec,
  deps: Pick<DeclarativeToolLoaderDeps, "buildChatPrompt" | "filterDisabledSkills">
): (input: { topic?: string; maxContextChars?: number }) => Promise<{ content: Array<{ type: string; text: string }> }> {
  const action: DeclarativeToolAction = spec.action;
  if (action.kind === "static-text") {
    return async () => ({ content: [{ type: "text", text: action.text }] });
  }
  // compose-prompt
  return async ({ topic, maxContextChars }) => {
    const { enabled } = await deps.filterDisabledSkills(action.skills ?? []);
    const text = await deps.buildChatPrompt(
      topic ?? action.defaultTopic ?? spec.name,
      action.agents,
      action.persona,
      enabled,
      [],
      6,
      maxContextChars,
      action.appendInstruction
    );
    return { content: [{ type: "text", text }] };
  };
}

export function registerDeclarativeTool(
  spec: DeclarativeToolSpec,
  deps: DeclarativeToolLoaderDeps,
  alreadyRegistered: Set<string>
): boolean {
  if (alreadyRegistered.has(spec.name)) return false;
  if (spec.governance?.deprecated === true) return false;
  alreadyRegistered.add(spec.name);
  deps.govTool(
    spec.name,
    {
      title: spec.title ?? spec.name,
      description: spec.description,
      tags: spec.tags ?? [],
      inputSchema: {
        topic: z.string().min(1).max(2000).optional(),
        maxContextChars: z.number().int().min(500).max(200000).optional()
      }
    },
    buildHandler(spec, deps)
  );
  return true;
}

export async function loadDeclarativeToolsFromDir(
  dir: string,
  deps: DeclarativeToolLoaderDeps,
  alreadyRegistered: Set<string> = new Set()
): Promise<LoadResult> {
  const result: LoadResult = { registered: [], skipped: [] };
  if (!existsSync(dir)) return result;
  let files: string[];
  try {
    files = await fsPromises.readdir(dir);
  } catch (e) {
    return { registered: [], skipped: [{ file: dir, reason: `readdir failed: ${(e as Error).message}` }] };
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(dir, file);
    try {
      const raw = await fsPromises.readFile(filePath, "utf-8");
      const json = JSON.parse(raw);
      const spec = parseToolSpec(json);
      if (!spec) {
        result.skipped.push({ file, reason: "spec parse failed" });
        continue;
      }
      if (alreadyRegistered.has(spec.name)) {
        result.skipped.push({ file, reason: `duplicate name: ${spec.name}` });
        continue;
      }
      const ok = registerDeclarativeTool(spec, deps, alreadyRegistered);
      if (ok) result.registered.push(spec.name);
      else result.skipped.push({ file, reason: "deprecated or duplicate" });
    } catch (e) {
      result.skipped.push({ file, reason: `IO/JSON error: ${(e as Error).message}` });
    }
  }
  return result;
}
