import { z, type ZodType } from "zod";

export type EventPayload = Record<string, unknown>;

export interface EventSchemaVersionEntry {
  version: number;
  schema: ZodType<EventPayload>;
  migrateFromPrevious?: (input: EventPayload) => EventPayload;
}

export type EventSchemaRegistryMap = Record<string, EventSchemaVersionEntry[]>;

const passthroughSchema = z.object({
  schemaVersion: z.number().int().positive().optional()
}).passthrough() as ZodType<EventPayload>;

export class EventSchemaRegistry {
  private readonly registry: Map<string, EventSchemaVersionEntry[]>;

  constructor(definitions: EventSchemaRegistryMap = {}) {
    this.registry = new Map<string, EventSchemaVersionEntry[]>();
    for (const [eventType, entries] of Object.entries(definitions)) {
      this.registry.set(
        eventType,
        [...entries].sort((a, b) => a.version - b.version)
      );
    }
  }

  validateForAppend(eventType: string, payload: EventPayload): EventPayload {
    const entries = this.registry.get(eventType);
    if (!entries || entries.length === 0) {
      return passthroughSchema.parse(payload);
    }
    const latest = entries[entries.length - 1]!;
    const parsed = latest.schema.parse(payload);
    if (typeof parsed.schemaVersion !== "number") {
      return { ...parsed, schemaVersion: latest.version };
    }
    return parsed;
  }

  migrateForRead(eventType: string, payload: EventPayload): EventPayload {
    const entries = this.registry.get(eventType);
    if (!entries || entries.length === 0) {
      return passthroughSchema.parse(payload);
    }

    const sorted = [...entries].sort((a, b) => a.version - b.version);
    const latest = sorted[sorted.length - 1]!;
    let current = passthroughSchema.parse(payload);
    const currentVersion =
      typeof current.schemaVersion === "number" && Number.isFinite(current.schemaVersion)
        ? current.schemaVersion
        : sorted[0]!.version;

    for (const entry of sorted) {
      if (entry.version <= currentVersion) {
        continue;
      }
      current = entry.migrateFromPrevious ? entry.migrateFromPrevious(current) : current;
      current = entry.schema.parse(current);
      if (typeof current.schemaVersion !== "number") {
        current = { ...current, schemaVersion: entry.version };
      }
    }

    const parsedLatest = latest.schema.parse(current);
    return typeof parsedLatest.schemaVersion === "number"
      ? parsedLatest
      : { ...parsedLatest, schemaVersion: latest.version };
  }
}
