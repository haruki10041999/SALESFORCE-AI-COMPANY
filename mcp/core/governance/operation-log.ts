import { existsSync, promises as fsPromises } from "fs";
import { dirname } from "path";
import type { ResourceOperation } from "./governance-manager.js";
import { maskUnknown } from "../logging/pii-masker.js";
import { PostgresRuntimeLogStore } from "../persistence/postgres-runtime-log-store.js";
import { AuditWriter } from "../audit/audit-writer.js";
import { getCurrentActorOrDefault } from "../identity/actor-context.js";
import { FileUnitOfWork } from "../persistence/unit-of-work.js";

export interface OperationLogDeps {
  logFile: string;
  ensureDir: (dir: string) => Promise<void>;
  databaseUrl?: string;
}

export function createOperationLog(deps: OperationLogDeps) {
  const { logFile, ensureDir, databaseUrl } = deps;
  const runtimeStorePromise = databaseUrl
    ? PostgresRuntimeLogStore.open({ databaseUrl }).catch(() => null)
    : Promise.resolve(null);
  // Hash-chained audit writer (Postgres only; no-op when DB unavailable)
  const auditWriterPromise = databaseUrl
    ? AuditWriter.open({ databaseUrl }).catch(() => null)
    : Promise.resolve(null);

  function toRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  async function loadRecentOperations(): Promise<ResourceOperation[]> {
    const runtimeStore = await runtimeStorePromise;
    if (runtimeStore) {
      const rows = await runtimeStore.listAuditLogs(200, "resource_operation");
      return rows
        .map((row) => row.details as Partial<ResourceOperation>)
        .filter((row): row is ResourceOperation => {
          return (
            (row.type === "create" || row.type === "delete" || row.type === "disable" || row.type === "enable") &&
            (row.resourceType === "skills" || row.resourceType === "tools" || row.resourceType === "presets") &&
            typeof row.name === "string" &&
            typeof row.timestamp === "string"
          );
        })
        .reverse();
    }

    if (!existsSync(logFile)) return [];
    const lines = (await fsPromises.readFile(logFile, "utf-8"))
      .split("\n")
      .filter((l) => l.trim());
    return lines
      .map((l) => {
        try {
          return JSON.parse(l) as ResourceOperation;
        } catch {
          return null;
        }
      })
      .filter((x): x is ResourceOperation => x !== null);
  }

  async function appendOperationLog(op: ResourceOperation): Promise<void> {
    const masked = maskUnknown(op);
    const maskedRecord = toRecord(masked);

    // Write to hash-chained audit_log table first (Postgres)
    const auditWriter = await auditWriterPromise;
    if (auditWriter) {
      const actor = getCurrentActorOrDefault();
      await auditWriter.append({
        tenantId: actor.tenantId,
        actorType: actor.type,
        actorId: actor.id,
        action: `resource.${op.type}`,
        resourceType: op.resourceType,
        resourceId: typeof op.name === "string" ? op.name : undefined,
        payload: maskedRecord,
        ts: op.timestamp
      });
      return;
    }

    // Fallback: legacy runtime log store (Postgres without hash chain)
    const runtimeStore = await runtimeStorePromise;
    if (runtimeStore) {
      await runtimeStore.appendAuditLog("resource_operation", op.resourceType, maskedRecord, op.timestamp);
      return;
    }

    // Fallback: file-based log
    await ensureDir(dirname(logFile));
    const current = existsSync(logFile) ? await fsPromises.readFile(logFile, "utf-8") : "";
    const unitOfWork = new FileUnitOfWork();
    await unitOfWork.stageFileWrite(logFile, current + JSON.stringify(masked) + "\n");
    await unitOfWork.commit();
  }

  return { loadRecentOperations, appendOperationLog };
}
