/**
 * Phase 2: Proposal applier.
 *
 * 承認された (もしくは Auto-apply gate を通過した) ProposalRecord を、
 * 実際のファイル書き込みまで進める。
 *
 * 設計方針:
 *   - skill / tool は既存の保存場所に JSON / Markdown を書き込む。
 *   - preset は最小フォーマット (name/description/topic/agents/skills) の
 *     ペイロード JSON として `outputs/presets/<slug>/v1.json` を書く。
 *     既存の preset-store の高度なバージョニングは create_preset 経由を推奨。
 *   - quality check / 上限チェックは呼び出し側 (approve / auto gate) が
 *     responsibility を持つ。本モジュールは「物理的な反映」のみを担う。
 *
 * 純粋関数 `slugifyResourceName` と I/O 関数 `applyProposal` を提供。
 * idempotent: 既存ファイルがあれば overwriteFlag=false の場合スキップする。
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProposalRecord } from "./proposal-queue.js";
import { DeclarativeToolSpecSchema } from "../declarative/tool-spec.js";

export interface ProposalApplyResult {
  applied: boolean;
  filePath: string;
  reason?: "already-exists" | "written";
}

export interface ProposalApplyOptions {
  /** リポジトリルート (skills/ 配下を解決するため) */
  repoRoot: string;
  /** outputs ルート (tools / presets の保存先) */
  outputsDir: string;
  /** 既存ファイルがあった場合に上書きするかどうか。既定は false。 */
  overwrite?: boolean;
}

const SLUG_PATTERN = /[^a-z0-9-]+/g;

export function slugifyResourceName(name: string): string {
  const base = name.trim().toLowerCase().replace(/\s+/g, "-").replace(SLUG_PATTERN, "-");
  const collapsed = base.replace(/-+/g, "-");
  const trimmed = collapsed.replace(/^-+|-+$/g, "").slice(0, 64);
  if (trimmed.length === 0) {
    throw new Error(`cannot slugify resource name: ${JSON.stringify(name)}`);
  }
  return trimmed;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function applySkill(record: ProposalRecord, options: ProposalApplyOptions): ProposalApplyResult {
  const skillsDir = resolve(options.repoRoot, "skills");
  ensureDir(skillsDir);
  const slug = slugifyResourceName(record.name);
  const filePath = join(skillsDir, `${slug}.md`);
  if (existsSync(filePath) && !options.overwrite) {
    return { applied: false, filePath, reason: "already-exists" };
  }
  writeFileSync(filePath, record.content, "utf-8");
  return { applied: true, filePath, reason: "written" };
}

function applyTool(record: ProposalRecord, options: ProposalApplyOptions): ProposalApplyResult {
  const toolsDir = join(options.outputsDir, "custom-tools");
  ensureDir(toolsDir);
  const slug = slugifyResourceName(record.name);
  const filePath = join(toolsDir, `${slug}.json`);
  if (existsSync(filePath) && !options.overwrite) {
    return { applied: false, filePath, reason: "already-exists" };
  }
  // content の解釈:
  //   1. JSON object としてパース可能なら payload として使う (action/agents 等を含められる)
  //   2. それ以外は description として扱う
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(record.content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    } else {
      payload = { description: String(record.content) };
    }
  } catch {
    payload = { description: String(record.content) };
  }

  // 新スキーマに正規化。action が無ければ legacy 互換として
  // compose-prompt にフォールバック (agents 必須なので最低 1 つを要求)。
  const draft: Record<string, unknown> = {
    schemaVersion: 1,
    name: payload.name ?? slug,
    title: payload.title,
    description: payload.description ?? record.name,
    tags: payload.tags ?? [],
    governance: payload.governance,
    action: payload.action ?? {
      kind: "compose-prompt",
      agents: Array.isArray(payload.agents) && payload.agents.length > 0
        ? payload.agents
        : ["captain"],
      persona: payload.persona,
      skills: Array.isArray(payload.skills) ? payload.skills : [],
      defaultTopic: payload.defaultTopic
    },
    createdAt: new Date().toISOString(),
    proposalId: record.id
  };

  const parsed = DeclarativeToolSpecSchema.safeParse(draft);
  if (!parsed.success) {
    // 検証失敗時は legacy 形式 (agents/skills/persona) を保存。loader 側 fromLegacyCustomTool が拾う。
    const legacy = {
      name: slug,
      description: typeof payload.description === "string" ? payload.description : record.name,
      agents: Array.isArray(payload.agents) ? payload.agents : ["captain"],
      skills: Array.isArray(payload.skills) ? payload.skills : [],
      persona: typeof payload.persona === "string" ? payload.persona : undefined,
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      createdAt: new Date().toISOString(),
      proposalId: record.id
    };
    writeFileSync(filePath, JSON.stringify(legacy, null, 2), "utf-8");
  } else {
    writeFileSync(filePath, JSON.stringify(parsed.data, null, 2), "utf-8");
  }
  return { applied: true, filePath, reason: "written" };
}

function nextPresetVersion(versionDir: string): number {
  if (!existsSync(versionDir)) return 1;
  const max = readdirSync(versionDir)
    .filter((n) => /^v\d+\.json$/.test(n))
    .map((n) => Number(n.replace(/^v(\d+)\.json$/, "$1")))
    .reduce((acc, v) => (v > acc ? v : acc), 0);
  return max + 1;
}

function applyPreset(record: ProposalRecord, options: ProposalApplyOptions): ProposalApplyResult {
  const slug = slugifyResourceName(record.name);
  const presetsRoot = join(options.outputsDir, "presets");
  ensureDir(presetsRoot);
  const versionDir = join(presetsRoot, slug);
  ensureDir(versionDir);

  // content を JSON として解釈。失敗したら description のみのプリセットとする。
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(record.content);
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { description: record.content };
  } catch {
    payload = { description: record.content };
  }

  const version = nextPresetVersion(versionDir);
  const versionFile = join(versionDir, `v${version}.json`);
  if (existsSync(versionFile) && !options.overwrite) {
    return { applied: false, filePath: versionFile, reason: "already-exists" };
  }
  const out = {
    name: record.name,
    slug,
    version,
    createdAt: new Date().toISOString(),
    proposalId: record.id,
    ...payload
  };
  writeFileSync(versionFile, JSON.stringify(out, null, 2), "utf-8");
  // ルート latest コピー
  const latestFile = join(presetsRoot, `${slug}.json`);
  writeFileSync(latestFile, JSON.stringify(out, null, 2), "utf-8");
  return { applied: true, filePath: versionFile, reason: "written" };
}

export function applyProposal(record: ProposalRecord, options: ProposalApplyOptions): ProposalApplyResult {
  switch (record.resourceType) {
    case "skills":  return applySkill(record, options);
    case "tools":   return applyTool(record, options);
    case "presets": return applyPreset(record, options);
    default: {
      // exhaustiveness guard
      const _exhaustive: never = record.resourceType;
      void _exhaustive;
      throw new Error(`unsupported resourceType: ${record.resourceType}`);
    }
  }
}
