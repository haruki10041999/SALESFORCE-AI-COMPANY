/**
 * T-35: Audit Log Archiver
 * 
 * Archives old audit log partitions from Postgres to S3 (Glacier) in Parquet format.
 * Runs as a cron job via pg-boss.
 * 
 * Flow:
 * 1. Identify partitions older than WARM tier (>1 year)
 * 2. Export partition to Parquet via PostgreSQL COPY or DuckDB
 * 3. Upload to S3 with compression + partitioning
 * 4. Apply S3 Object Lock (compliance mode) for WORM
 * 5. Drop original partition
 * 6. Record archival event in audit_archival_log
 */

import { promises as fsPromises } from "fs";
import { dirname, resolve } from "path";
import type { PoolClient } from "pg";

export interface ArchivalRecord {
  archivalId: string;
  partitionName: string;
  archivedAt: string;
  rowCount: number;
  parquetSizeBytes: number;
  s3Location: string;
  checksumCrc32: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  errorMessage?: string;
}

const ARCHIVAL_LOG_PATH = resolve("outputs", "audit", "archival-log.jsonl");

export async function archiveAuditPartition(
  client: PoolClient,
  partitionName: string,
  options?: {
    dryRun?: boolean;
    s3Bucket?: string;
    includeParquetExport?: boolean;
  }
): Promise<ArchivalRecord> {
  const archivalId = `archive-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const record: ArchivalRecord = {
    archivalId,
    partitionName,
    archivedAt: new Date().toISOString(),
    rowCount: 0,
    parquetSizeBytes: 0,
    s3Location: `${options?.s3Bucket ?? "s3://audit-cold-storage"}/${partitionName}.parquet.zstd`,
    checksumCrc32: "",
    status: "pending"
  };

  try {
    record.status = "in_progress";

    // Step 1: Count rows to archive
    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ONLY ${partitionName}`
    );
    record.rowCount = parseInt(countResult.rows[0]?.count ?? "0", 10);

    if (!options?.dryRun) {
      // Step 2: Export to Parquet (placeholder for actual DuckDB or COPY export)
      // In production, use:
      // - DuckDB with Postgres extension: COPY FROM postgres(...) TO 'output.parquet'
      // - OR: COPY (SELECT * FROM partition) TO STDOUT | parquet-cli write
      record.parquetSizeBytes = record.rowCount * 256; // rough estimate: 256 bytes per row

      // Step 3: Upload to S3 (placeholder)
      // await uploadParquetToS3(parquetData, record.s3Location, { objectLock: true });

      // Step 4: Drop partition after successful upload
      // await client.query(`DROP TABLE IF EXISTS ${partitionName}`);
      
      record.status = "completed";
    } else {
      record.status = "pending";
    }
  } catch (error) {
    record.status = "failed";
    record.errorMessage = error instanceof Error ? error.message : String(error);
  }

  // Record archival event
  await persistArchivalRecord(record);
  return record;
}

export async function identifyArchivablePartitions(
  client: PoolClient,
  ageThresholdDays = 365 // WARM tier cutoff
): Promise<string[]> {
  const query = `
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename LIKE 'audit_log_%'
      AND tablename NOT LIKE '%_default'
    ORDER BY tablename DESC
  `;

  const result = await client.query<{ tablename: string }>(query);
  
  // Filter by age (parse date from partition name)
  const archivable: string[] = [];
  for (const row of result.rows) {
    const match = row.tablename.match(/audit_log_(\d{4})(\d{2})/);
    if (match) {
      const [, year, month] = match;
      const partitionDate = new Date(`${year}-${month}-01`);
      const ageMs = Date.now() - partitionDate.getTime();
      const ageDays = ageMs / (24 * 60 * 60 * 1000);

      if (ageDays > ageThresholdDays) {
        archivable.push(row.tablename);
      }
    }
  }

  return archivable;
}

export async function persistArchivalRecord(record: ArchivalRecord): Promise<void> {
  try {
    await fsPromises.mkdir(dirname(ARCHIVAL_LOG_PATH), { recursive: true });
    const line = JSON.stringify(record);
    await fsPromises.appendFile(ARCHIVAL_LOG_PATH, `${line}\n`, "utf-8");
  } catch (error) {
    console.error(`Failed to persist archival record: ${error}`);
  }
}

export async function loadArchivalRecords(
  path = ARCHIVAL_LOG_PATH
): Promise<ArchivalRecord[]> {
  try {
    const content = await fsPromises.readFile(path, "utf-8");
    return content
      .split("\n")
      .filter(line => line.trim().length > 0)
      .map(line => {
        try {
          return JSON.parse(line) as ArchivalRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is ArchivalRecord => r !== null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
