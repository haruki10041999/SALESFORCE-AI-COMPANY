/**
 * Phase 2: Proposal applier.
 *
 * 承認された (もしくは Auto-apply gate を通過した) ProposalRecord を、
 * 実際の反映処理まで進める。
 *
 * 設計方針:
 *   - skill は既存の保存場所に Markdown を書き込む。
 *   - tool / preset の file 反映は fallback 用であり、
 *     `SF_AI_CUSTOM_TOOL_FILE_FALLBACK=true` / `SF_AI_PRESET_FILE_FALLBACK=true`
 *     のときのみ書き込む (既定は無効)。
 *   - quality check / 上限チェックは呼び出し側 (approve / auto gate) が
 *     responsibility を持つ。本モジュールは「物理的な反映」のみを担う。
 *
 * 純粋関数 `slugifyResourceName` と I/O 関数 `applyProposal` を提供。
 * idempotent: 既存ファイルがあれば overwrite=false の場合スキップする。
 */

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { atomicWriteFileSync, ensureDirectorySync } from "../../io/atomic-write.js";
import { isEnvFlagEnabled } from "../../config/env-flags.js";
import type { ProposalRecord } from "./queue.js";
import { DeclarativeToolSpecSchema } from "../../declarative/tool-spec.js";
import type { OutputsPort } from "../../ports/outputs-port.js";
import { LocalOutputsAdapter } from "../../../infrastructure/outputs/local-outputs-adapter.js";

export interface ProposalApplyResult {
  applied: boolean;
  filePath: string;
  reason?: "already-exists" | "written" | "file-fallback-disabled";
}

export interface ProposalApplyOptions {
  /** リポジトリルート (skills/ 配下を解決するため) */
  repoRoot: string;
  /** outputs ルート (fallback file 保存先) */
  outputsDir: string;
  /** 既存ファイルがあった場合に上書きするかどうか。既定は false。 */
  overwrite?: boolean;
  /** OutputsPort を明示指定する場合に利用。未指定時は LocalOutputsAdapter。 */
  outputsPort?: OutputsPort;
}

const SLUG_PATTERN = /[^a-z0-9-]+/g;

function isFileFallbackEnabled(envName: string): boolean {
  return isEnvFlagEnabled(envName);
}

export function slugifyResourceName(name: string): string {
  const base = name.trim().toLowerCase().replace(/\s+/g, "-").replace(SLUG_PATTERN, "-");
  const collapsed = base.replace(/-+/g, "-");
  const trimmed = collapsed.replace(/^-+|-+$/g, "").slice(0, 64);
  if (trimmed.length === 0) {
    throw new Error(`cannot slugify resource name: ${JSON.stringify(name)}`);
  }
  return trimmed;
}

function applySkill(record: ProposalRecord, options: ProposalApplyOptions): ProposalApplyResult {
  const skillsDir = resolve(options.repoRoot, "skills");
  ensureDirectorySync(skillsDir);
  const slug = slugifyResourceName(record.name);
  const filePath = join(skillsDir, `${slug}.md`);
  if (existsSync(filePath) && !options.overwrite) {
    return { applied: false, filePath, reason: "already-exists" };
  }
  atomicWriteFileSync(filePath, record.content, "utf-8");
  return { applied: true, filePath, reason: "written" };
}

function applyTool(record: ProposalRecord, options: ProposalApplyOptions): ProposalApplyResult {
  const toolsDir = join(options.outputsDir, "custom-tools");
  const slug = slugifyResourceName(record.name);
  const filePath = join(toolsDir, `${slug}.json`);
  if (!isFileFallbackEnabled("SF_AI_CUSTOM_TOOL_FILE_FALLBACK")) {
    return { applied: false, filePath, reason: "file-fallback-disabled" };
  }
  ensureDirectorySync(toolsDir);
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
    atomicWriteFileSync(filePath, JSON.stringify(legacy, null, 2), "utf-8");
  } else {
    atomicWriteFileSync(filePath, JSON.stringify(parsed.data, null, 2), "utf-8");
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

function resolveOutputsPort(options: ProposalApplyOptions): OutputsPort {
  if (options.outputsPort) {
    return options.outputsPort;
  }
  return new LocalOutputsAdapter({ outputsDir: options.outputsDir });
}

async function applyToolAsync(record: ProposalRecord, options: ProposalApplyOptions): Promise<ProposalApplyResult> {
  const slug = slugifyResourceName(record.name);
  const relativePath = `custom-tools/${slug}.json`;
  const filePath = join(options.outputsDir, relativePath);
  if (!isFileFallbackEnabled("SF_AI_CUSTOM_TOOL_FILE_FALLBACK")) {
    return { applied: false, filePath, reason: "file-fallback-disabled" };
  }

  const outputsPort = resolveOutputsPort(options);
  const existing = await outputsPort.readArtifact(relativePath);
  if (existing !== null && !options.overwrite) {
    return { applied: false, filePath, reason: "already-exists" };
  }

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

  if (!DeclarativeToolSpecSchema.safeParse(draft).success) {
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
    await outputsPort.writeArtifact(relativePath, JSON.stringify(legacy, null, 2));
    return { applied: true, filePath, reason: "written" };
  }

  await outputsPort.writeArtifact(relativePath, JSON.stringify(draft, null, 2));
  return { applied: true, filePath, reason: "written" };
}

async function applyPresetAsync(record: ProposalRecord, options: ProposalApplyOptions): Promise<ProposalApplyResult> {
  const slug = slugifyResourceName(record.name);
  const presetsRoot = join(options.outputsDir, "presets");
  const versionDir = join(presetsRoot, slug);
  if (!isFileFallbackEnabled("SF_AI_PRESET_FILE_FALLBACK")) {
    return {
      applied: false,
      filePath: join(versionDir, "v1.json"),
      reason: "file-fallback-disabled"
    };
  }

  ensureDirectorySync(versionDir);
  const version = nextPresetVersion(versionDir);
  const relativeVersionPath = `presets/${slug}/v${version}.json`;
  const relativeLatestPath = `presets/${slug}.json`;
  const versionFile = join(versionDir, `v${version}.json`);

  const outputsPort = resolveOutputsPort(options);
  const existing = await outputsPort.readArtifact(relativeVersionPath);
  if (existing !== null && !options.overwrite) {
    return { applied: false, filePath: versionFile, reason: "already-exists" };
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(record.content);
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { description: record.content };
  } catch {
    payload = { description: record.content };
  }

  const out = {
    name: record.name,
    slug,
    version,
    createdAt: new Date().toISOString(),
    proposalId: record.id,
    ...payload
  };

  const body = JSON.stringify(out, null, 2);
  await outputsPort.writeArtifact(relativeVersionPath, body);
  await outputsPort.writeArtifact(relativeLatestPath, body);
  return { applied: true, filePath: versionFile, reason: "written" };
}

export async function applyProposalAsync(record: ProposalRecord, options: ProposalApplyOptions): Promise<ProposalApplyResult> {
  switch (record.resourceType) {
    case "skills":
      return applySkill(record, options);
    case "tools":
      return applyToolAsync(record, options);
    case "presets":
      return applyPresetAsync(record, options);
    default: {
      const _exhaustive: never = record.resourceType;
      void _exhaustive;
      throw new Error(`unsupported resourceType: ${record.resourceType}`);
    }
  }
}

function applyPreset(record: ProposalRecord, options: ProposalApplyOptions): ProposalApplyResult {
  const slug = slugifyResourceName(record.name);
  const presetsRoot = join(options.outputsDir, "presets");
  if (!isFileFallbackEnabled("SF_AI_PRESET_FILE_FALLBACK")) {
    return {
      applied: false,
      filePath: join(presetsRoot, slug, "v1.json"),
      reason: "file-fallback-disabled"
    };
  }
  ensureDirectorySync(presetsRoot);
  const versionDir = join(presetsRoot, slug);
  ensureDirectorySync(versionDir);

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
  atomicWriteFileSync(versionFile, JSON.stringify(out, null, 2), "utf-8");
  // ルート latest コピー
  const latestFile = join(presetsRoot, `${slug}.json`);
  atomicWriteFileSync(latestFile, JSON.stringify(out, null, 2), "utf-8");
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
