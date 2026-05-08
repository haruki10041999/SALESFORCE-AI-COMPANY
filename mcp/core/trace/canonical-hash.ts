import { createHash } from "node:crypto";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function removePath(target: unknown, path: string[]): void {
  if (!target || typeof target !== "object" || path.length === 0) {
    return;
  }
  const [head, ...tail] = path;
  if (!(head in (target as Record<string, unknown>))) {
    return;
  }
  if (tail.length === 0) {
    delete (target as Record<string, unknown>)[head];
    return;
  }
  removePath((target as Record<string, unknown>)[head], tail);
}

function normalizeUnknown(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeUnknown(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const cloned: Record<string, JsonValue> = {};
    for (const key of Object.keys(record).sort()) {
      if (key === "__nondeterministic") {
        continue;
      }
      cloned[key] = normalizeUnknown(record[key]);
    }
    return cloned;
  }
  return String(value);
}

export function normalizeForHash(input: unknown): JsonValue {
  const normalized = normalizeUnknown(input);
  if (
    normalized &&
    typeof normalized === "object" &&
    !Array.isArray(normalized) &&
    input &&
    typeof input === "object" &&
    Array.isArray((input as Record<string, unknown>).__nondeterministic)
  ) {
    for (const rawPath of (input as Record<string, unknown>).__nondeterministic as unknown[]) {
      if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
        continue;
      }
      removePath(normalized, rawPath.split(".").filter(Boolean));
    }
  }
  return normalized;
}

export function hashCanonicalValue(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizeForHash(input)), "utf-8")
    .digest("hex");
}