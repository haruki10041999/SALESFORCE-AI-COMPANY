import { promises as fsPromises } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { maskUnknown } from "../logging/pii-masker.js";
import { PostgresRuntimeLogStore, type RuntimeToolExecutionRecord } from "../persistence/postgres-runtime-log-store.js";
import { hashCanonicalValue } from "./canonical-hash.js";
import { currentTenantId } from "../identity/tenant-context.js";

export type ReplayMode = "passthrough" | "record" | "replay";

export interface ToolRecorderExecutionResult<T> {
  result: T;
  replayed: boolean;
  mode: ReplayMode;
  argsHash: string;
  recordId?: string;
}

export class ToolExecutionRecorder {
  private readonly outputsDir: string;
  private readonly mode: ReplayMode;
  private readonly runtimeStorePromise: Promise<PostgresRuntimeLogStore | null>;

  public constructor(options: {
    outputsDir: string;
    databaseUrl?: string;
    mode?: ReplayMode;
  }) {
    this.outputsDir = resolve(options.outputsDir);
    this.mode = options.mode ?? resolveReplayMode();
    this.runtimeStorePromise = options.databaseUrl
      ? PostgresRuntimeLogStore.open({ databaseUrl: options.databaseUrl }).catch(() => null)
      : Promise.resolve(null);
  }

  public async execute<T>(options: {
    toolName: string;
    input: unknown;
    handler: () => Promise<T>;
    sessionId?: string;
  }): Promise<ToolRecorderExecutionResult<T>> {
    const argsHash = hashCanonicalValue(options.input);
    const tenantId = currentTenantId();

    if (this.mode === "replay") {
      const existing = await this.findExecution(options.toolName, argsHash, tenantId);
      if (!existing) {
        throw new Error(`Tool recorder replay miss: tool='${options.toolName}' argsHash='${argsHash}'`);
      }
      if (existing.status === "error") {
        throw new Error(String(existing.outputJson.errorMessage ?? "Recorded tool execution failed"));
      }
      return {
        result: existing.outputJson as T,
        replayed: true,
        mode: this.mode,
        argsHash,
        recordId: existing.id
      };
    }

    if (this.mode === "passthrough") {
      return {
        result: await options.handler(),
        replayed: false,
        mode: this.mode,
        argsHash
      };
    }

    const startedAt = Date.now();
    try {
      const result = await options.handler();
      const maskedInput = toRecord(maskUnknown(options.input));
      const maskedOutput = toRecord(maskUnknown(result));
      const record: RuntimeToolExecutionRecord = {
        id: createId(),
        tenantId,
        ts: new Date(startedAt).toISOString(),
        sessionId: options.sessionId,
        toolName: options.toolName,
        argsHash,
        argsJson: maskedInput,
        outputHash: hashCanonicalValue(maskedOutput),
        outputJson: maskedOutput,
        durationMs: Date.now() - startedAt,
        status: "success",
        recordedAt: new Date().toISOString()
      };
      await this.persistExecution(record);
      return {
        result,
        replayed: false,
        mode: this.mode,
        argsHash,
        recordId: record.id
      };
    } catch (error) {
      const maskedInput = toRecord(maskUnknown(options.input));
      const outputJson = {
        errorMessage: error instanceof Error ? error.message : String(error)
      };
      const record: RuntimeToolExecutionRecord = {
        id: createId(),
        tenantId,
        ts: new Date(startedAt).toISOString(),
        sessionId: options.sessionId,
        toolName: options.toolName,
        argsHash,
        argsJson: maskedInput,
        outputHash: hashCanonicalValue(outputJson),
        outputJson,
        durationMs: Date.now() - startedAt,
        status: "error",
        recordedAt: new Date().toISOString()
      };
      await this.persistExecution(record);
      throw error;
    }
  }

  private async findExecution(toolName: string, argsHash: string, tenantId?: string): Promise<RuntimeToolExecutionRecord | null> {
    const store = await this.runtimeStorePromise;
    if (store) {
      return store.findToolExecution(toolName, argsHash, tenantId);
    }
    const filePath = this.recordingFilePath(toolName, argsHash, tenantId);
    try {
      const raw = await fsPromises.readFile(filePath, "utf-8");
      return JSON.parse(raw) as RuntimeToolExecutionRecord;
    } catch {
      return null;
    }
  }

  private async persistExecution(record: RuntimeToolExecutionRecord): Promise<void> {
    const store = await this.runtimeStorePromise;
    if (store) {
      await store.upsertToolExecution(record);
    }
    const filePath = this.recordingFilePath(record.toolName, record.argsHash, record.tenantId);
    await fsPromises.mkdir(dirname(filePath), { recursive: true });
    await fsPromises.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");

    if (record.sessionId) {
      const sessionDir = join(this.outputsDir, "recordings", record.sessionId);
      await fsPromises.mkdir(sessionDir, { recursive: true });
      const tenantPrefix = record.tenantId ? `${record.tenantId}-` : "global-";
      await fsPromises.writeFile(join(sessionDir, `${tenantPrefix}${record.toolName}-${record.argsHash}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf-8");
    }
  }

  private recordingFilePath(toolName: string, argsHash: string, tenantId?: string): string {
    const safeToolName = toolName.replace(/[^a-z0-9._-]/gi, "_");
    const tenantScope = tenantId ?? "__global";
    return join(this.outputsDir, "recordings", "tools", tenantScope, safeToolName, `${argsHash}.json`);
  }
}

function resolveReplayMode(env: NodeJS.ProcessEnv = process.env): ReplayMode {
  const normalized = (env.SF_AI_REPLAY_MODE ?? "passthrough").trim().toLowerCase();
  if (normalized === "record" || normalized === "replay" || normalized === "passthrough") {
    return normalized;
  }
  return "passthrough";
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}