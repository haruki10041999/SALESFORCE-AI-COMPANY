/**
 * Optional YAML-ish frontmatter parser for agents/personas/skills Markdown files.
 *
 * 現状リポジトリの agents/personas/skills は本文のみで frontmatter を持たないため、
 * 本モジュールは将来的な opt-in 用の純粋関数だけを提供する。
 *
 * - frontmatter が存在しない場合は `{ data: {}, body: source }` を返す。
 * - `---` で囲まれた最小サブセット (key: value, key: [a, b]) のみ対応。
 *   YAML 全機能はサポートしない (依存ゼロを優先)。
 *
 * zod スキーマと組み合わせて agent / persona / skill の宣言的メタデータ検証に使える:
 *
 * ```ts
 * const { data } = parseFrontmatter(raw);
 * const meta = AgentFrontmatterSchema.parse(data);
 * ```
 */

import { z } from "zod";

export interface FrontmatterParseResult {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(source: string): FrontmatterParseResult {
  const m = source.match(FRONTMATTER_RE);
  if (!m) return { data: {}, body: source };
  const block = m[1];
  const body = source.slice(m[0].length);
  const data: Record<string, unknown> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const valueRaw = line.slice(colon + 1).trim();
    if (valueRaw.startsWith("[") && valueRaw.endsWith("]")) {
      const inner = valueRaw.slice(1, -1).trim();
      data[key] = inner.length === 0
        ? []
        : inner.split(",").map((s) => stripQuotes(s.trim()));
    } else if (valueRaw === "true" || valueRaw === "false") {
      data[key] = valueRaw === "true";
    } else if (valueRaw !== "" && !Number.isNaN(Number(valueRaw))) {
      data[key] = Number(valueRaw);
    } else {
      data[key] = stripQuotes(valueRaw);
    }
  }
  return { data, body };
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** agents/*.md (将来的な frontmatter スキーマ) */
export const AgentFrontmatterSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  expertise: z.array(z.string()).optional(),
  defaultPersona: z.string().optional(),
  deprecated: z.boolean().optional(),
  tags: z.array(z.string()).optional()
}).strict();

/** personas/*.md */
export const PersonaFrontmatterSchema = z.object({
  name: z.string().min(1).optional(),
  tone: z.string().optional(),
  hints: z.array(z.string()).optional(),
  deprecated: z.boolean().optional()
}).strict();

/** skills/**\/SKILL.md */
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).optional(),
  topic: z.string().optional(),
  agents: z.array(z.string()).optional(),
  deprecated: z.boolean().optional(),
  tags: z.array(z.string()).optional()
}).strict();

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;
export type PersonaFrontmatter = z.infer<typeof PersonaFrontmatterSchema>;
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
