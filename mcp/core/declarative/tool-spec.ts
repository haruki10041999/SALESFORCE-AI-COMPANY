/**
 * Declarative tool spec.
 *
 * # 分類ポリシー (declarative vs code)
 *
 * MCP ツールは以下 2 層に分けて管理する:
 *
 *  - **declarative tool** … 純粋にメタデータ + 既存ツール/プロンプトの合成のみで成立するもの。
 *    JSON で定義し、本モジュールの `DeclarativeToolSpec` に従って起動時に動的登録される。
 *    例: 特定 agents/skills/persona を束ねた chat-prompt ラッパ、固定テキスト返却、別ツール委譲。
 *
 *  - **code tool** … 副作用 (ファイル I/O, 静的解析, 外部 API) や複雑な制御フローを伴うもの。
 *    `mcp/handlers/register-*.ts` 配下に TypeScript で実装し、zod による厳格な inputSchema を持つ。
 *    例: `apex_analyze` / `apply_proposal` / `governance_*` 系。
 *
 * 判定基準:
 *  1. 入力検証以外の TS ロジックが必要か → 必要なら **code**
 *  2. 副作用 (fs / network / exec) があるか → あれば **code**
 *  3. 出力が「既存資産の合成」だけで作れるか → Yes なら **declarative**
 *
 * # action kind
 *
 *  - `compose-prompt` … `chat-prompt-builder` を呼び出して合成プロンプトを返す
 *    (既存 `CustomToolDefinition` 互換)。
 *  - `static-text`    … 固定テキストを返す (FAQ / テンプレート用)。
 *
 * 将来追加候補: `call-tool` (別ツール委譲), `pipeline` (複数ツールの連鎖)。
 */

import { z } from "zod";

const TOOL_NAME = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, "tool name must be lowercase (a-z, 0-9, _, -)");

const ComposePromptAction = z.object({
  kind: z.literal("compose-prompt"),
  agents: z.array(z.string().min(1)).min(1),
  persona: z.string().min(1).optional(),
  skills: z.array(z.string().min(1)).default([]),
  defaultTopic: z.string().min(1).optional(),
  appendInstruction: z.string().min(1).optional()
});

const StaticTextAction = z.object({
  kind: z.literal("static-text"),
  text: z.string().min(1)
});

export const DeclarativeToolSpecSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  name: TOOL_NAME,
  title: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(2000),
  tags: z.array(z.string().min(1)).default([]),
  /** declarative ツールも governance.allowedAgents 等で絞れるよう用意 */
  governance: z.object({
    allowedAgents: z.array(z.string().min(1)).optional(),
    deprecated: z.boolean().optional()
  }).optional(),
  action: z.discriminatedUnion("kind", [ComposePromptAction, StaticTextAction]),
  createdAt: z.string().min(1).optional(),
  /** apply_proposal 経由で生成された場合の元 ID */
  proposalId: z.string().min(1).optional()
});

export type DeclarativeToolSpec = z.infer<typeof DeclarativeToolSpecSchema>;
export type DeclarativeToolAction = DeclarativeToolSpec["action"];

/**
 * 旧 `CustomToolDefinition` (agents/skills/persona/description のみ) を
 * 新 `DeclarativeToolSpec` (action: compose-prompt) に変換する純粋関数。
 * 移行期間中の互換維持用。
 */
export function fromLegacyCustomTool(legacy: {
  name: string;
  description: string;
  agents: string[];
  skills?: string[];
  persona?: string;
  tags?: string[];
  createdAt?: string;
}): DeclarativeToolSpec {
  return DeclarativeToolSpecSchema.parse({
    schemaVersion: 1,
    name: legacy.name,
    description: legacy.description,
    tags: legacy.tags ?? [],
    action: {
      kind: "compose-prompt",
      agents: legacy.agents,
      persona: legacy.persona,
      skills: legacy.skills ?? []
    },
    createdAt: legacy.createdAt
  });
}

/**
 * legacy か新スキーマか判定して `DeclarativeToolSpec` を返す。
 * 失敗時は `null` (loader 側でスキップする)。
 */
export function parseToolSpec(raw: unknown): DeclarativeToolSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  // 新スキーマ
  if (obj.action && typeof obj.action === "object") {
    const r = DeclarativeToolSpecSchema.safeParse(obj);
    return r.success ? r.data : null;
  }
  // legacy
  if (typeof obj.name === "string" && Array.isArray(obj.agents)) {
    try {
      return fromLegacyCustomTool(obj as Parameters<typeof fromLegacyCustomTool>[0]);
    } catch {
      return null;
    }
  }
  return null;
}
