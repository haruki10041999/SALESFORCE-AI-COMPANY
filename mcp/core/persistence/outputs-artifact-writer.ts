import { promises as fsPromises } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RuntimeExecutionOriginRecord } from "./postgres-runtime-log-store.js";
import { PostgresRuntimeLogStore } from "./postgres-runtime-log-store.js";

export interface OutputsArtifactWriterOptions {
  outputsDir: string;
  databaseUrl?: string;
}

/**
 * Writes runtime artifacts to DB-first destinations with file fallback.
 *
 * Goal (T-25): reduce outputs/ as semi-DB by prioritizing durable stores.
 */
export class OutputsArtifactWriter {
  private readonly outputsDir: string;
  private readonly runtimeStorePromise: Promise<PostgresRuntimeLogStore | null>;
  private static readonly ALLOWED_ARTIFACT_PREFIXES = [
    "reports/",
    "dashboards/",
    "exports/",
    "recordings/",
    "backups/",
    "setup/"
  ];

  public constructor(options: OutputsArtifactWriterOptions) {
    this.outputsDir = resolve(options.outputsDir);
    this.runtimeStorePromise = options.databaseUrl
      ? PostgresRuntimeLogStore.open({ databaseUrl: options.databaseUrl }).catch(() => null)
      : Promise.resolve(null);
  }

  public async appendAuditArtifact(
    eventType: string,
    resourceType: string | null,
    details: Record<string, unknown>,
    timestamp = new Date().toISOString(),
    fallbackRelativePath = "audit/tool-executions.jsonl"
  ): Promise<void> {
    const store = await this.runtimeStorePromise;
    if (store) {
      await store.appendAuditLog(eventType, resourceType, details, timestamp);
      return;
    }
    await this.appendJsonlUnchecked(fallbackRelativePath, {
      recordedAt: timestamp,
      eventType,
      resourceType,
      ...details
    });
  }

  public async appendExecutionOrigin(
    record: Omit<RuntimeExecutionOriginRecord, "id"> & { id?: string }
  ): Promise<void> {
    const normalizedRecord: RuntimeExecutionOriginRecord = {
      id: record.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ...record
    };
    const store = await this.runtimeStorePromise;
    if (store) {
      await store.appendExecutionOrigin(normalizedRecord);
      return;
    }
    await this.appendJsonlUnchecked("execution-origins.jsonl", normalizedRecord);
  }

  public async appendJsonl(relativePath: string, payload: unknown): Promise<void> {
    this.assertArtifactPathAllowed(relativePath);
    await this.appendJsonlUnchecked(relativePath, payload);
  }

  public async writeText(relativePath: string, content: string): Promise<void> {
    this.assertArtifactPathAllowed(relativePath);
    await this.writeTextUnchecked(relativePath, content);
  }

  public async writeJson(relativePath: string, payload: unknown, space = 2): Promise<void> {
    this.assertArtifactPathAllowed(relativePath);
    await this.writeTextUnchecked(relativePath, `${JSON.stringify(payload, null, space)}\n`);
  }

  private async appendJsonlUnchecked(relativePath: string, payload: unknown): Promise<void> {
    const fullPath = join(this.outputsDir, relativePath);
    await fsPromises.mkdir(dirname(fullPath), { recursive: true });
    await fsPromises.appendFile(fullPath, `${JSON.stringify(payload)}\n`, "utf-8");
  }

  private async writeTextUnchecked(relativePath: string, content: string): Promise<void> {
    const fullPath = join(this.outputsDir, relativePath);
    await fsPromises.mkdir(dirname(fullPath), { recursive: true });
    await fsPromises.writeFile(fullPath, content, "utf-8");
  }

  private assertArtifactPathAllowed(relativePath: string): void {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
    if (normalized.includes("..")) {
      throw new Error(`outputs artifact path must not traverse directories: ${relativePath}`);
    }
    const allowed = OutputsArtifactWriter.ALLOWED_ARTIFACT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
    if (!allowed) {
      throw new Error(
        `outputs state write is prohibited: ${relativePath}. allowed prefixes: ${OutputsArtifactWriter.ALLOWED_ARTIFACT_PREFIXES.join(", ")}`
      );
    }
  }
}
