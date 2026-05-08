import fs from "node:fs";
import { SafeFilePathSchema, runSchemaValidation } from "../core/quality/resource-validation.js";
import {
  collectEnabledSystemPermissions,
  collectPermissionSetBlocks,
  getPermissionSetBooleanTag,
  getPermissionSetTagText
} from "./permission-set-xml.js";

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

  for (const block of collectPermissionSetBlocks(xml, "objectPermissions")) {
    const object = getPermissionSetTagText(block, "object");
    if (!object) continue;

    objectPermissions.set(object, {
      object,
      allowRead: getPermissionSetBooleanTag(block, "allowRead"),
      allowCreate: getPermissionSetBooleanTag(block, "allowCreate"),
      allowEdit: getPermissionSetBooleanTag(block, "allowEdit"),
      allowDelete: getPermissionSetBooleanTag(block, "allowDelete"),
      viewAllRecords: getPermissionSetBooleanTag(block, "viewAllRecords"),
      modifyAllRecords: getPermissionSetBooleanTag(block, "modifyAllRecords")
    });
  }

  for (const block of collectPermissionSetBlocks(xml, "fieldPermissions")) {
    const field = getPermissionSetTagText(block, "field");
    if (!field) continue;

    fieldPermissions.set(field, {
      field,
      readable: getPermissionSetBooleanTag(block, "readable"),
      editable: getPermissionSetBooleanTag(block, "editable")
    });
  }

  for (const block of collectPermissionSetBlocks(xml, "classAccesses")) {
    if (!getPermissionSetBooleanTag(block, "enabled")) {
      continue;
    }
    const apexClass = getPermissionSetTagText(block, "apexClass");
    if (apexClass) {
      apexClasses.add(apexClass);
    }
  }

  for (const systemPermission of collectEnabledSystemPermissions(xml)) {
    systemPermissions.add(systemPermission);
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
