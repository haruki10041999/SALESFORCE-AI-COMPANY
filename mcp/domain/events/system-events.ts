import { z } from "zod";
import type { EventSchemaRegistryMap } from "../../core/event/schema-registry.js";

const systemEventPayloadV1 = z.object({
  schemaVersion: z.literal(1).optional()
}).passthrough();

export const SYSTEM_EVENT_SCHEMA_REGISTRY: EventSchemaRegistryMap = {
  resource_gap_detected: [{ version: 1, schema: systemEventPayloadV1 }],
  resource_created: [{ version: 1, schema: systemEventPayloadV1 }],
  resource_deleted: [{ version: 1, schema: systemEventPayloadV1 }],
  error_aggregate_detected: [{ version: 1, schema: systemEventPayloadV1 }],
  governance_threshold_exceeded: [{ version: 1, schema: systemEventPayloadV1 }],
  quality_check_failed: [{ version: 1, schema: systemEventPayloadV1 }],
  cascade_impact_detected: [{ version: 1, schema: systemEventPayloadV1 }]
};
