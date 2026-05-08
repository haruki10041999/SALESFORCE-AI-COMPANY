import { parsePositiveIntOrFallback } from "../config/numeric-parsing.js";

export type DataClassificationLabel = "public" | "internal" | "confidential" | "restricted";

export interface DataRetentionPolicy {
  classification: DataClassificationLabel;
  retentionDays: number;
}

export interface DataRetentionTarget {
  relativeDir: string;
  recursive: boolean;
  classification: DataClassificationLabel;
}

export interface ResolvedDataRetentionTarget extends DataRetentionTarget {
  retentionDays: number;
}

export const DEFAULT_RETENTION_DAYS: Record<DataClassificationLabel, number> = {
  public: 365,
  internal: 180,
  confidential: 90,
  restricted: 30
};

export const DEFAULT_RETENTION_TARGETS: DataRetentionTarget[] = [
  { relativeDir: "reports", recursive: true, classification: "public" },
  { relativeDir: "dashboards", recursive: true, classification: "public" },
  { relativeDir: "benchmark", recursive: true, classification: "public" },
  { relativeDir: "debug", recursive: true, classification: "public" },
  { relativeDir: "history", recursive: true, classification: "internal" },
  { relativeDir: "sessions", recursive: true, classification: "internal" },
  { relativeDir: "tool-proposals", recursive: true, classification: "internal" },
  { relativeDir: "events", recursive: true, classification: "confidential" },
  { relativeDir: "audit", recursive: true, classification: "confidential" }
];

export function buildDataRetentionPolicy(env: NodeJS.ProcessEnv = process.env): DataRetentionPolicy[] {
  return [
    {
      classification: "public",
      retentionDays: parsePositiveIntOrFallback(env.SF_AI_RETENTION_DAYS_PUBLIC, DEFAULT_RETENTION_DAYS.public)
    },
    {
      classification: "internal",
      retentionDays: parsePositiveIntOrFallback(env.SF_AI_RETENTION_DAYS_INTERNAL, DEFAULT_RETENTION_DAYS.internal)
    },
    {
      classification: "confidential",
      retentionDays: parsePositiveIntOrFallback(env.SF_AI_RETENTION_DAYS_CONFIDENTIAL, DEFAULT_RETENTION_DAYS.confidential)
    },
    {
      classification: "restricted",
      retentionDays: parsePositiveIntOrFallback(env.SF_AI_RETENTION_DAYS_RESTRICTED, DEFAULT_RETENTION_DAYS.restricted)
    }
  ];
}

export function resolveRetentionTargets(
  policy: DataRetentionPolicy[],
  targets: DataRetentionTarget[] = DEFAULT_RETENTION_TARGETS
): ResolvedDataRetentionTarget[] {
  const daysByClass = new Map<DataClassificationLabel, number>(
    policy.map((item) => [item.classification, item.retentionDays])
  );

  return targets.map((target) => ({
    ...target,
    retentionDays: daysByClass.get(target.classification) ?? DEFAULT_RETENTION_DAYS[target.classification]
  }));
}
