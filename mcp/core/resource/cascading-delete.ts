/**
 * Cascading Dependency Safe Delete
 *
 * resource (skills | tools | presets) を delete / disable する際に、
 * 依存している downstream resource を検出して安全に拒否 / 警告 / 強行できるようにする。
 *
 * 依存検出ロジック:
 *  - skills: 同名を `skills` 配列に含む presets が downstream
 *  - tools : (将来拡張) tool config に依存する presets が downstream
 *  - presets: 自身を参照する higher-level preset は無いため downstream は通常 0
 *
 * 既存の resource-dependency-graph と重複を避けるため、ここでは
 * presets ディレクトリのみを軽量にスキャンする実装とする。
 */

import { promises as fsPromises, existsSync } from "node:fs";
import { join } from "node:path";

export type CascadeMode = "force" | "prompt" | "block";

export type GovernedResourceTypeForCascade = "skills" | "tools" | "presets";

export interface CascadeDownstreamRef {
  type: "presets";
  name: string;
  sourcePath: string;
  reason: string;
}

export interface CascadeImpactResult {
  resourceType: GovernedResourceTypeForCascade;
  name: string;
  downstream: CascadeDownstreamRef[];
  /** mode に基づいて呼び出し側が削除を中断すべきか */
  blocked: boolean;
  /** 構造化メッセージ（ログ・レポート用） */
  message: string;
}

interface PresetFileShape {
  name?: string;
  agents?: string[];
  skills?: string[];
  persona?: string;
  filePaths?: string[];
}

async function readPresetFile(filePath: string): Promise<PresetFileShape | null> {
  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as PresetFileShape;
  } catch {
    return null;
  }
}

async function listPresetFiles(presetsDir: string): Promise<string[]> {
  if (!existsSync(presetsDir)) return [];
  const entries = await fsPromises.readdir(presetsDir);
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => join(presetsDir, entry));
}

/**
 * 与えられた resource に依存する downstream を列挙する。
 */
export async function detectCascadeImpact(args: {
  resourceType: GovernedResourceTypeForCascade;
  name: string;
  presetsDir: string;
}): Promise<CascadeDownstreamRef[]> {
  const { resourceType, name, presetsDir } = args;
  if (resourceType === "presets") return [];

  const presetFiles = await listPresetFiles(presetsDir);
  const downstream: CascadeDownstreamRef[] = [];

  for (const filePath of presetFiles) {
    const preset = await readPresetFile(filePath);
    if (!preset) continue;
    const presetName = preset.name ?? filePath;

    if (resourceType === "skills") {
      const skills = Array.isArray(preset.skills) ? preset.skills : [];
      if (skills.includes(name)) {
        downstream.push({
          type: "presets",
          name: presetName,
          sourcePath: filePath,
          reason: `preset "${presetName}" includes skill "${name}"`
        });
      }
    } else if (resourceType === "tools") {
      // 現状 preset スキーマに tools 直接参照は無いが将来拡張用に対応
      const filePaths = Array.isArray(preset.filePaths) ? preset.filePaths : [];
      if (filePaths.some((p) => p.includes(name))) {
        downstream.push({
          type: "presets",
          name: presetName,
          sourcePath: filePath,
          reason: `preset "${presetName}" references tool path containing "${name}"`
        });
      }
    }
  }

  return downstream;
}

/**
 * mode に基づいて削除の是非を判定する。
 */
export async function evaluateCascadeDeletion(args: {
  resourceType: GovernedResourceTypeForCascade;
  name: string;
  presetsDir: string;
  mode: CascadeMode;
}): Promise<CascadeImpactResult> {
  const { resourceType, name, presetsDir, mode } = args;
  const downstream = await detectCascadeImpact({ resourceType, name, presetsDir });

  let blocked = false;
  let message = "";
  if (downstream.length === 0) {
    message = `no downstream dependencies detected for ${resourceType}:${name}`;
  } else {
    const refList = downstream.map((d) => `${d.type}:${d.name}`).join(", ");
    if (mode === "block") {
      blocked = true;
      message = `delete blocked: ${downstream.length} downstream dependents (${refList})`;
    } else if (mode === "prompt") {
      blocked = false;
      message = `delete proceeds with WARNING: ${downstream.length} downstream dependents (${refList})`;
    } else {
      blocked = false;
      message = `delete forced despite ${downstream.length} downstream dependents (${refList})`;
    }
  }

  return { resourceType, name, downstream, blocked, message };
}

/**
 * Markdown 影響レポートを生成する。
 */
export function renderCascadeImpactMarkdown(result: CascadeImpactResult): string {
  const lines: string[] = [];
  lines.push(`# Cascade Impact Report`);
  lines.push("");
  lines.push(`- resourceType: ${result.resourceType}`);
  lines.push(`- name: ${result.name}`);
  lines.push(`- blocked: ${result.blocked}`);
  lines.push(`- downstreamCount: ${result.downstream.length}`);
  lines.push(`- message: ${result.message}`);
  lines.push("");
  if (result.downstream.length === 0) {
    lines.push("_No downstream dependents detected._");
    return lines.join("\n");
  }
  lines.push(`| type | name | reason | sourcePath |`);
  lines.push(`|---|---|---|---|`);
  for (const ref of result.downstream) {
    lines.push(`| ${ref.type} | ${ref.name} | ${ref.reason} | ${ref.sourcePath} |`);
  }
  return lines.join("\n");
}
