import { existsSync, readFileSync } from "node:fs";

export type OrgInventoryInput = {
  org: string;
  inventoryFile: string;
};

export type MetadataComponent = {
  type: string;
  name: string;
};

export type OrgMetadataDiffInput = {
  baselineOrg: string;
  baselineInventoryFile: string;
  compareOrgs: OrgInventoryInput[];
  sampleLimit?: number;
};

export type OrgMetadataDiffResult = {
  baseline: {
    org: string;
    totalComponents: number;
    byType: Record<string, number>;
  };
  comparisons: Array<{
    org: string;
    totalComponents: number;
    commonCount: number;
    addedCount: number;
    missingCount: number;
    addedByType: Record<string, number>;
    missingByType: Record<string, number>;
    addedSamples: string[];
    missingSamples: string[];
    riskLevel: "low" | "medium" | "high";
    summary: string;
  }>;
};

function normalizeOrgName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("org 名は必須です。");
  }
  if (!/^[a-zA-Z0-9@._\-]+$/.test(trimmed)) {
    throw new Error(`org 名に使用できない文字が含まれています: ${value}`);
  }
  return trimmed;
}

function ensureReadableFile(pathValue: string, fieldName: string): void {
  if (!pathValue || /[\n\r\0]/.test(pathValue)) {
    throw new Error(`${fieldName} が不正です。`);
  }
  if (!existsSync(pathValue)) {
    throw new Error(`${fieldName} が存在しません: ${pathValue}`);
  }
}

function parseComponentFromString(value: string): MetadataComponent {
  const parts = value.split(":");
  if (parts.length < 2) {
    throw new Error(`文字列コンポーネントは 'Type:Name' 形式で指定してください: ${value}`);
  }

  const type = parts[0]?.trim();
  const name = parts.slice(1).join(":").trim();
  if (!type || !name) {
    throw new Error(`コンポーネント形式が不正です: ${value}`);
  }

  return { type, name };
}

function parseInventory(raw: unknown): MetadataComponent[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (typeof item === "string") {
        return parseComponentFromString(item);
      }
      if (item && typeof item === "object") {
        const component = item as { type?: unknown; name?: unknown };
        if (typeof component.type === "string" && typeof component.name === "string") {
          return { type: component.type.trim(), name: component.name.trim() };
        }
      }
      throw new Error("配列要素の形式が不正です。string か {type,name} を指定してください。");
    });
  }

  if (raw && typeof raw === "object") {
    const withComponents = raw as { components?: unknown };
    if (Array.isArray(withComponents.components)) {
      return parseInventory(withComponents.components);
    }
  }

  throw new Error("インベントリ形式が不正です。配列または { components: [] } を指定してください。");
}

function loadInventory(filePath: string, fieldName: string): MetadataComponent[] {
  ensureReadableFile(filePath, fieldName);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    throw new Error(`${fieldName} の JSON 解析に失敗しました: ${String(error)}`);
  }

  const items = parseInventory(parsed)
    .map((item) => ({ type: item.type.trim(), name: item.name.trim() }))
    .filter((item) => item.type && item.name);

  const unique = new Map<string, MetadataComponent>();
  for (const item of items) {
    unique.set(`${item.type}:${item.name}`, item);
  }

  return [...unique.values()];
}

function toSet(components: MetadataComponent[]): Set<string> {
  return new Set(components.map((item) => `${item.type}:${item.name}`));
}

function countByType(keys: Iterable<string>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of keys) {
    const [type] = key.split(":");
    if (!type) continue;
    result[type] = (result[type] ?? 0) + 1;
  }
  return result;
}

function diffSets(base: Set<string>, target: Set<string>): { added: string[]; missing: string[]; commonCount: number } {
  const added: string[] = [];
  const missing: string[] = [];
  let commonCount = 0;

  for (const key of target) {
    if (base.has(key)) {
      commonCount += 1;
    } else {
      added.push(key);
    }
  }

  for (const key of base) {
    if (!target.has(key)) {
      missing.push(key);
    }
  }

  added.sort();
  missing.sort();

  return { added, missing, commonCount };
}

function determineRiskLevel(addedCount: number, missingCount: number, baseTotal: number): "low" | "medium" | "high" {
  const delta = addedCount + missingCount;
  const ratio = baseTotal === 0 ? (delta > 0 ? 1 : 0) : delta / baseTotal;

  if (missingCount >= 30 || ratio >= 0.3) {
    return "high";
  }
  if (missingCount >= 10 || ratio >= 0.1) {
    return "medium";
  }
  return "low";
}

export function compareOrgMetadata(input: OrgMetadataDiffInput): OrgMetadataDiffResult {
  const baselineOrg = normalizeOrgName(input.baselineOrg);
  const sampleLimit = Number.isFinite(input.sampleLimit) ? Math.max(1, Math.floor(input.sampleLimit ?? 10)) : 10;

  if (!Array.isArray(input.compareOrgs) || input.compareOrgs.length === 0) {
    throw new Error("compareOrgs は 1 件以上必要です。");
  }

  const baselineComponents = loadInventory(input.baselineInventoryFile, "baselineInventoryFile");
  const baselineSet = toSet(baselineComponents);

  const comparisons = input.compareOrgs.map((orgInput, index) => {
    const org = normalizeOrgName(orgInput.org);
    const components = loadInventory(orgInput.inventoryFile, `compareOrgs[${index}].inventoryFile`);
    const currentSet = toSet(components);
    const diff = diffSets(baselineSet, currentSet);
    const riskLevel = determineRiskLevel(diff.added.length, diff.missing.length, baselineSet.size);

    return {
      org,
      totalComponents: currentSet.size,
      commonCount: diff.commonCount,
      addedCount: diff.added.length,
      missingCount: diff.missing.length,
      addedByType: countByType(diff.added),
      missingByType: countByType(diff.missing),
      addedSamples: diff.added.slice(0, sampleLimit),
      missingSamples: diff.missing.slice(0, sampleLimit),
      riskLevel,
      summary: [
        `Org: ${org}`,
        `共通: ${diff.commonCount}`,
        `追加: ${diff.added.length}`,
        `不足: ${diff.missing.length}`,
        `リスク: ${riskLevel}`
      ].join(" | ")
    };
  });

  return {
    baseline: {
      org: baselineOrg,
      totalComponents: baselineSet.size,
      byType: countByType(baselineSet)
    },
    comparisons
  };
}
