import { parseBooleanLike } from "../core/config/env-flags.js";

export function getPermissionSetTagText(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

export function getPermissionSetBooleanTag(block: string, tag: string): boolean {
  return parseBooleanLike(getPermissionSetTagText(block, tag), false);
}

export function collectPermissionSetBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) => m[1] ?? "");
}

export function collectEnabledSystemPermissions(xml: string): Set<string> {
  const systemPermissions = new Set<string>();
  for (const [, rawName, rawValue] of xml.matchAll(/<permissions([A-Za-z0-9_]+)>(true|false)<\/permissions\1>/g)) {
    if (parseBooleanLike(rawValue, false)) {
      systemPermissions.add(rawName);
    }
  }
  return systemPermissions;
}
