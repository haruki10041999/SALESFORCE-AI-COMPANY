/**
 * T-35: Audit Log Retention Policy Configuration
 * 
 * Defines retention tiers for audit logs:
 * - HOT: 90 days (Postgres, full access)
 * - WARM: 1 year (Postgres, query-only)
 * - COLD: 7 years (S3 Glacier, archival only)
 */

export interface AuditRetentionTier {
  name: "hot" | "warm" | "cold";
  maxAgeDays: number;
  storage: "postgres" | "s3";
  accessPattern: "read-write" | "read-only" | "archive";
  estimatedCostPerTbPerYear: number; // USD
}

export const AUDIT_RETENTION_TIERS: AuditRetentionTier[] = [
  {
    name: "hot",
    maxAgeDays: 90,
    storage: "postgres",
    accessPattern: "read-write",
    estimatedCostPerTbPerYear: 12 * 1024 // ~$12k/TB/yr for Postgres (rough)
  },
  {
    name: "warm",
    maxAgeDays: 365,
    storage: "postgres",
    accessPattern: "read-only",
    estimatedCostPerTbPerYear: 6 * 1024 // ~$6k/TB/yr (compressed/partitioned)
  },
  {
    name: "cold",
    maxAgeDays: 7 * 365, // 7 years
    storage: "s3",
    accessPattern: "archive",
    estimatedCostPerTbPerYear: 50 // ~$50/TB/yr for S3 Glacier
  }
];

export function getTierForAge(ageMs: number): AuditRetentionTier {
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return AUDIT_RETENTION_TIERS.find(t => ageDays <= t.maxAgeDays) ?? AUDIT_RETENTION_TIERS[2];
}

export function recommendedColdStorageTarget(): string {
  return process.env.SF_AI_AUDIT_COLD_STORAGE ?? "s3://audit-cold-storage/";
}

export function auditPartitionNameForDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `audit_log_${year}${month}`;
}

export function isColdStorageEnabled(): boolean {
  const enabled = process.env.SF_AI_AUDIT_COLD_STORAGE_ENABLED ?? "false";
  return enabled.toLowerCase() === "true";
}
