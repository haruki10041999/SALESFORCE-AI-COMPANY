import fs from "node:fs";
import { normalizeSampleLimit } from "../core/config/normalized-limits.js";
import { SafeFilePathSchema, runSchemaValidation } from "../core/quality/resource-validation.js";
import {
  collectEnabledSystemPermissions,
  collectPermissionSetBlocks,
  getPermissionSetBooleanTag,
  getPermissionSetTagText
} from "./permission-set-xml.js";

type ObjectPermission = {
  object: string;
  allowRead: boolean;
  allowCreate: boolean;
  allowEdit: boolean;
  allowDelete: boolean;
  viewAllRecords: boolean;
  modifyAllRecords: boolean;
};

type FieldPermission = {
  field: string;
  readable: boolean;
  editable: boolean;
};

type ParsedPermissionSet = {
  objectPermissions: Map<string, ObjectPermission>;
  fieldPermissions: Map<string, FieldPermission>;
  systemPermissions: Set<string>;
};

export type PermissionSetDiffInput = {
  baselineFilePath: string;
  targetFilePath: string;
  sampleLimit?: number;
};

export type PermissionSetDiffResult = {
  baselineFilePath: string;
  targetFilePath: string;
  summary: {
    baselineObjectCount: number;
    targetObjectCount: number;
    baselineFieldCount: number;
    targetFieldCount: number;
    baselineSystemPermissionCount: number;
    targetSystemPermissionCount: number;
    missingCount: number;
    excessiveCount: number;
    riskLevel: "low" | "medium" | "high";
  };
  missingInTarget: {
    objectPermissions: string[];
    fieldPermissions: string[];
    systemPermissions: string[];
  };
  excessiveInTarget: {
    objectPermissions: string[];
    fieldPermissions: string[];
    systemPermissions: string[];
  };
  suggestions: string[];
};

function readXml(filePath: string, fieldName: string): string {
  const check = runSchemaValidation(SafeFilePathSchema, filePath);
  if (!check.success) {
    throw new Error(`Invalid ${fieldName}: ${check.errors.join(", ")}`);
  }
  return fs.readFileSync(filePath, "utf-8");
}

function parsePermissionSet(xml: string): ParsedPermissionSet {
  const objectPermissions = new Map<string, ObjectPermission>();
  const fieldPermissions = new Map<string, FieldPermission>();
  const systemPermissions = collectEnabledSystemPermissions(xml);

  for (const block of collectPermissionSetBlocks(xml, "objectPermissions")) {
    const objectName = getPermissionSetTagText(block, "object");
    if (!objectName) continue;

    objectPermissions.set(objectName, {
      object: objectName,
      allowRead: getPermissionSetBooleanTag(block, "allowRead"),
      allowCreate: getPermissionSetBooleanTag(block, "allowCreate"),
      allowEdit: getPermissionSetBooleanTag(block, "allowEdit"),
      allowDelete: getPermissionSetBooleanTag(block, "allowDelete"),
      viewAllRecords: getPermissionSetBooleanTag(block, "viewAllRecords"),
      modifyAllRecords: getPermissionSetBooleanTag(block, "modifyAllRecords")
    });
  }

  for (const block of collectPermissionSetBlocks(xml, "fieldPermissions")) {
    const fieldName = getPermissionSetTagText(block, "field");
    if (!fieldName) continue;

    fieldPermissions.set(fieldName, {
      field: fieldName,
      readable: getPermissionSetBooleanTag(block, "readable"),
      editable: getPermissionSetBooleanTag(block, "editable")
    });
  }

  return {
    objectPermissions,
    fieldPermissions,
    systemPermissions
  };
}

function objectPermissionKey(item: ObjectPermission): string {
  return [
    item.object,
    item.allowRead,
    item.allowCreate,
    item.allowEdit,
    item.allowDelete,
    item.viewAllRecords,
    item.modifyAllRecords
  ].join("|");
}

function fieldPermissionKey(item: FieldPermission): string {
  return [item.field, item.readable, item.editable].join("|");
}

function mapToKeySet<T>(map: Map<string, T>, toKey: (value: T) => string): Set<string> {
  const result = new Set<string>();
  for (const value of map.values()) {
    result.add(toKey(value));
  }
  return result;
}

function setDifference(a: Set<string>, b: Set<string>): string[] {
  const result: string[] = [];
  for (const value of a) {
    if (!b.has(value)) {
      result.push(value);
    }
  }
  return result.sort();
}

function pickSamples(values: string[], sampleLimit: number): string[] {
  return values.slice(0, sampleLimit);
}

function riskLevel(missingCount: number, excessiveCount: number): "low" | "medium" | "high" {
  const total = missingCount + excessiveCount;
  if (missingCount >= 20 || excessiveCount >= 20 || total >= 30) return "high";
  if (missingCount >= 5 || excessiveCount >= 5 || total >= 10) return "medium";
  return "low";
}

function buildSuggestions(missingCount: number, excessiveCount: number): string[] {
  const suggestions: string[] = [];

  if (missingCount > 0) {
    suggestions.push("不足権限があるため、target 側への権限追加または baseline 設計見直しを検討してください。");
  }
  if (excessiveCount > 0) {
    suggestions.push("過剰権限があるため、target 側の不要な権限を削除して最小権限に寄せてください。");
  }
  if (missingCount === 0 && excessiveCount === 0) {
    suggestions.push("差分はありません。権限セットは整合しています。");
  }

  return suggestions;
}

export function diffPermissionSet(input: PermissionSetDiffInput): PermissionSetDiffResult {
  const sampleLimit = normalizeSampleLimit(input.sampleLimit, 10);

  const baselineXml = readXml(input.baselineFilePath, "baselineFilePath");
  const targetXml = readXml(input.targetFilePath, "targetFilePath");

  const baseline = parsePermissionSet(baselineXml);
  const target = parsePermissionSet(targetXml);

  const baselineObjectKeys = mapToKeySet(baseline.objectPermissions, objectPermissionKey);
  const targetObjectKeys = mapToKeySet(target.objectPermissions, objectPermissionKey);

  const baselineFieldKeys = mapToKeySet(baseline.fieldPermissions, fieldPermissionKey);
  const targetFieldKeys = mapToKeySet(target.fieldPermissions, fieldPermissionKey);

  const missingObjectPermissions = setDifference(baselineObjectKeys, targetObjectKeys);
  const excessiveObjectPermissions = setDifference(targetObjectKeys, baselineObjectKeys);

  const missingFieldPermissions = setDifference(baselineFieldKeys, targetFieldKeys);
  const excessiveFieldPermissions = setDifference(targetFieldKeys, baselineFieldKeys);

  const missingSystemPermissions = setDifference(baseline.systemPermissions, target.systemPermissions);
  const excessiveSystemPermissions = setDifference(target.systemPermissions, baseline.systemPermissions);

  const missingCount =
    missingObjectPermissions.length + missingFieldPermissions.length + missingSystemPermissions.length;
  const excessiveCount =
    excessiveObjectPermissions.length + excessiveFieldPermissions.length + excessiveSystemPermissions.length;

  return {
    baselineFilePath: input.baselineFilePath,
    targetFilePath: input.targetFilePath,
    summary: {
      baselineObjectCount: baseline.objectPermissions.size,
      targetObjectCount: target.objectPermissions.size,
      baselineFieldCount: baseline.fieldPermissions.size,
      targetFieldCount: target.fieldPermissions.size,
      baselineSystemPermissionCount: baseline.systemPermissions.size,
      targetSystemPermissionCount: target.systemPermissions.size,
      missingCount,
      excessiveCount,
      riskLevel: riskLevel(missingCount, excessiveCount)
    },
    missingInTarget: {
      objectPermissions: pickSamples(missingObjectPermissions, sampleLimit),
      fieldPermissions: pickSamples(missingFieldPermissions, sampleLimit),
      systemPermissions: pickSamples(missingSystemPermissions, sampleLimit)
    },
    excessiveInTarget: {
      objectPermissions: pickSamples(excessiveObjectPermissions, sampleLimit),
      fieldPermissions: pickSamples(excessiveFieldPermissions, sampleLimit),
      systemPermissions: pickSamples(excessiveSystemPermissions, sampleLimit)
    },
    suggestions: buildSuggestions(missingCount, excessiveCount)
  };
}
