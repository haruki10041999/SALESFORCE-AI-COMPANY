import fs from "node:fs";
import { SafeFilePathSchema, runSchemaValidation } from "../core/quality/resource-validation.js";

export type PermissionSetAnalysis = {
  path: string;
  objectPermissionCount: number;
  objectModifyAllCount: number;
  fieldPermissionCount: number;
  fieldEditCount: number;
  hasViewAllData: boolean;
  hasModifyAllData: boolean;
  riskHints: string[];
};

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

export function analyzePermissionSet(filePath: string): PermissionSetAnalysis {
  const pathCheck = runSchemaValidation(SafeFilePathSchema, filePath);
  if (!pathCheck.success) {
    throw new Error(`Invalid filePath: ${pathCheck.errors.join(", ")}`);
  }

  const src = fs.readFileSync(filePath, "utf-8");

  const objectPermissionCount = countMatches(src, /<objectPermissions>/g);
  const objectModifyAllCount = countMatches(src, /<modifyAllRecords>true<\/modifyAllRecords>/g);
  const fieldPermissionCount = countMatches(src, /<fieldPermissions>/g);
  const fieldEditCount = countMatches(src, /<editable>true<\/editable>/g);
  const hasViewAllData = /<permissionsViewAllData>true<\/permissionsViewAllData>/.test(src);
  const hasModifyAllData = /<permissionsModifyAllData>true<\/permissionsModifyAllData>/.test(src);

  const riskHints: string[] = [];
  if (hasModifyAllData) {
    riskHints.push("Modify All Data が有効です。最小権限の原則に反する可能性があります。");
  }
  if (hasViewAllData) {
    riskHints.push("View All Data が有効です。機密データ露出範囲を確認してください。");
  }
  if (objectModifyAllCount > 0) {
    riskHints.push("modifyAllRecords=true のオブジェクト権限があります。");
  }
  if (fieldEditCount > 50) {
    riskHints.push("editable=true のフィールド権限が多く、過剰付与の見直し余地があります。");
  }

  return {
    path: filePath,
    objectPermissionCount,
    objectModifyAllCount,
    fieldPermissionCount,
    fieldEditCount,
    hasViewAllData,
    hasModifyAllData,
    riskHints
  };
}
