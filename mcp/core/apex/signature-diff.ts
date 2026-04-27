/**
 * TASK-A14: Apex public/global シグネチャ差分検出。
 *
 * 2 つの Apex ソース文字列を比較し、public / global メソッド・フィールドの
 * 追加・削除・変更を breaking change として分類する。
 *
 * 依存: mcp/core/parsers/apex-ast.ts の analyzeApexSource
 */

import { analyzeApexSource, type ApexMethod, type ApexField } from "../parsers/apex-ast.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignatureChangeKind =
  | "method-added"
  | "method-removed"
  | "method-signature-changed"
  | "field-added"
  | "field-removed"
  | "field-type-changed";

export type SignatureChange = {
  kind: SignatureChangeKind;
  name: string;
  /** true = consumers must update call sites */
  isBreaking: boolean;
  detail: string;
};

export type ApexSignatureDiffResult = {
  className: string;
  /** apiVersion parsed from `<version>` or `<apiVersion>` in XML suffix comment (if any). */
  apiVersionBefore?: string;
  apiVersionAfter?: string;
  changes: SignatureChange[];
  breakingCount: number;
  nonBreakingCount: number;
  /** Salesforce Apex Reference URL template (filled in with className). */
  referenceUrl: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PUBLIC_MODIFIERS = new Set(["public", "global"]);

function isPublicOrGlobal(modifiers: string[]): boolean {
  return modifiers.some((m) => PUBLIC_MODIFIERS.has(m.toLowerCase()));
}

function methodKey(m: ApexMethod): string {
  const params = m.parameters.map((p) => p.type).join(",");
  return `${m.name}(${params}):${m.returnType}`;
}

function methodSignatureKey(m: ApexMethod): string {
  const params = m.parameters.map((p) => p.type).join(",");
  return `${m.name}(${params})`;
}

function fieldKey(f: ApexField): string {
  return `${f.name}:${f.type}`;
}

function extractApiVersion(source: string): string | undefined {
  const match = source.match(/<(?:api)?[Vv]ersion>\s*([\d.]+)\s*<\/(?:api)?[Vv]ersion>/);
  return match?.[1];
}

// ---------------------------------------------------------------------------
// Core diff function
// ---------------------------------------------------------------------------

/**
 * 2 つの Apex ソース文字列を比較し、public/global のシグネチャ変更を返す。
 *
 * @param before - 旧バージョンのソース（null = 新規追加ファイル）
 * @param after  - 新バージョンのソース（null = 削除ファイル）
 * @param fallbackName - ファイル名ベースのクラス名フォールバック
 */
export function diffApexSignatures(
  before: string | null,
  after: string | null,
  fallbackName: string
): ApexSignatureDiffResult {
  const changes: SignatureChange[] = [];

  const apiVersionBefore = before ? extractApiVersion(before) : undefined;
  const apiVersionAfter = after ? extractApiVersion(after) : undefined;

  const aUnits = before ? analyzeApexSource(before).units : [];
  const bUnits = after ? analyzeApexSource(after).units : [];

  // Use the primary unit name from `after`, falling back to `before`, then file name.
  const className =
    bUnits[0]?.name ?? aUnits[0]?.name ?? fallbackName;

  // Collect all units by name from before
  const beforeUnitMap = new Map(aUnits.map((u) => [u.name, u]));
  const afterUnitMap = new Map(bUnits.map((u) => [u.name, u]));

  // Compare units present in both
  const allUnitNames = new Set([...beforeUnitMap.keys(), ...afterUnitMap.keys()]);

  for (const unitName of allUnitNames) {
    const bUnit = beforeUnitMap.get(unitName);
    const aUnit = afterUnitMap.get(unitName);

    const beforeMethods = (bUnit?.methods ?? []).filter((m) => isPublicOrGlobal(m.modifiers));
    const afterMethods = (aUnit?.methods ?? []).filter((m) => isPublicOrGlobal(m.modifiers));
    const beforeFields = (bUnit?.fields ?? []).filter((f) => isPublicOrGlobal(f.modifiers));
    const afterFields = (aUnit?.fields ?? []).filter((f) => isPublicOrGlobal(f.modifiers));

    // Index methods by overload key (name + param types)
    const beforeMethodMap = new Map(beforeMethods.map((m) => [methodSignatureKey(m), m]));
    const afterMethodMap = new Map(afterMethods.map((m) => [methodSignatureKey(m), m]));

    // Removed methods
    for (const [sig, m] of beforeMethodMap) {
      if (!afterMethodMap.has(sig)) {
        changes.push({
          kind: "method-removed",
          name: `${unitName}.${m.name}`,
          isBreaking: true,
          detail: `public/global method removed: ${methodKey(m)}`
        });
      }
    }

    // Added or signature-changed methods
    for (const [sig, m] of afterMethodMap) {
      const prev = beforeMethodMap.get(sig);
      if (!prev) {
        changes.push({
          kind: "method-added",
          name: `${unitName}.${m.name}`,
          isBreaking: false,
          detail: `public/global method added: ${methodKey(m)}`
        });
      } else if (methodKey(prev) !== methodKey(m)) {
        changes.push({
          kind: "method-signature-changed",
          name: `${unitName}.${m.name}`,
          isBreaking: true,
          detail: `return type changed: ${prev.returnType} → ${m.returnType}`
        });
      }
    }

    // Fields
    const beforeFieldMap = new Map(beforeFields.map((f) => [f.name, f]));
    const afterFieldMap = new Map(afterFields.map((f) => [f.name, f]));

    for (const [name, f] of beforeFieldMap) {
      if (!afterFieldMap.has(name)) {
        changes.push({
          kind: "field-removed",
          name: `${unitName}.${name}`,
          isBreaking: true,
          detail: `public/global field removed: ${fieldKey(f)}`
        });
      }
    }
    for (const [name, f] of afterFieldMap) {
      const prev = beforeFieldMap.get(name);
      if (!prev) {
        changes.push({
          kind: "field-added",
          name: `${unitName}.${name}`,
          isBreaking: false,
          detail: `public/global field added: ${fieldKey(f)}`
        });
      } else if (prev.type !== f.type) {
        changes.push({
          kind: "field-type-changed",
          name: `${unitName}.${name}`,
          isBreaking: true,
          detail: `field type changed: ${prev.type} → ${f.type}`
        });
      }
    }
  }

  const breakingCount = changes.filter((c) => c.isBreaking).length;
  const nonBreakingCount = changes.filter((c) => !c.isBreaking).length;
  const referenceUrl = `https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_ref_guide.htm#${encodeURIComponent(className)}`;

  return {
    className,
    apiVersionBefore,
    apiVersionAfter,
    changes,
    breakingCount,
    nonBreakingCount,
    referenceUrl
  };
}
