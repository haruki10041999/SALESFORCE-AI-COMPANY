import fs from "node:fs";
import { SafeFilePathSchema, runSchemaValidation } from "../core/quality/resource-validation.js";

export type PermissionSetObjectPermission = {
  object: string;
  allowRead: boolean;
  allowCreate: boolean;
  allowEdit: boolean;
  allowDelete: boolean;
  viewAllRecords: boolean;
  modifyAllRecords: boolean;
};

export type PermissionSetFieldPermission = {
  field: string;
  readable: boolean;
  editable: boolean;
};

export type PermissionSetCapabilities = {
  objectPermissions: Map<string, PermissionSetObjectPermission>;
  fieldPermissions: Map<string, PermissionSetFieldPermission>;
  apexClasses: Set<string>;
  systemPermissions: Set<string>;
};

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

function getTagText(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

function getBooleanTag(block: string, tag: string): boolean {
  return getTagText(block, tag).toLowerCase() === "true";
}

function collectBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) => m[1] ?? "");
}

export function parsePermissionSetCapabilities(filePath: string): PermissionSetCapabilities {
  const pathCheck = runSchemaValidation(SafeFilePathSchema, filePath);
  if (!pathCheck.success) {
    throw new Error(`Invalid filePath: ${pathCheck.errors.join(", ")}`);
  }

  const xml = fs.readFileSync(filePath, "utf-8");

  const objectPermissions = new Map<string, PermissionSetObjectPermission>();
  const fieldPermissions = new Map<string, PermissionSetFieldPermission>();
  const apexClasses = new Set<string>();
  const systemPermissions = new Set<string>();

  for (const block of collectBlocks(xml, "objectPermissions")) {
    const object = getTagText(block, "object");
    if (!object) continue;

    objectPermissions.set(object, {
      object,
      allowRead: getBooleanTag(block, "allowRead"),
      allowCreate: getBooleanTag(block, "allowCreate"),
      allowEdit: getBooleanTag(block, "allowEdit"),
      allowDelete: getBooleanTag(block, "allowDelete"),
      viewAllRecords: getBooleanTag(block, "viewAllRecords"),
      modifyAllRecords: getBooleanTag(block, "modifyAllRecords")
    });
  }

  for (const block of collectBlocks(xml, "fieldPermissions")) {
    const field = getTagText(block, "field");
    if (!field) continue;

    fieldPermissions.set(field, {
      field,
      readable: getBooleanTag(block, "readable"),
      editable: getBooleanTag(block, "editable")
    });
  }

  for (const block of collectBlocks(xml, "classAccesses")) {
    if (!getBooleanTag(block, "enabled")) {
      continue;
    }
    const apexClass = getTagText(block, "apexClass");
    if (apexClass) {
      apexClasses.add(apexClass);
    }
  }

  for (const [, rawName, rawValue] of xml.matchAll(/<permissions([A-Za-z0-9_]+)>(true|false)<\/permissions\1>/g)) {
    if (rawValue.toLowerCase() === "true") {
      systemPermissions.add(rawName);
    }
  }

  return {
    objectPermissions,
    fieldPermissions,
    apexClasses,
    systemPermissions
  };
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
