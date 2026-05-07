/**
 * YAML frontmatter parser for agents/personas/skills Markdown files.
 *
 * gray-matter ライブラリを使用して、frontmatter（YAML）を確実にパースする。
 * エラーハンドリングと YAML 形式の厳密性は gray-matter が保証。
 *
 * zod スキーマと組み合わせて agent / persona / skill の宣言的メタデータを検証:
 *
 * ```ts
 * const { data } = parseFrontmatter(raw);
 * const meta = AgentFrontmatterSchema.parse(data);
 * ```
 */

import { z } from "zod";
import matter from "gray-matter";

export interface FrontmatterParseResult {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(source: string): FrontmatterParseResult {
  try {
    const { data, content } = matter(source);
    return {
      data: data as Record<string, unknown>,
      body: content
    };
  } catch {
    // YAML パースエラーの場合は、frontmatter がないとして扱う
    return { data: {}, body: source };
  }
}

/** agents/*.md (将来的な frontmatter スキーマ) */
export const AgentFrontmatterSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  capability: z.string().min(1).optional(),
  triggerKeywords: z.array(z.string()).optional(),
  suggestedSkills: z.array(z.string()).optional(),
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
