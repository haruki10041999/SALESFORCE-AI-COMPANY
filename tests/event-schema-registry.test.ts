import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { EventSchemaRegistry } from "../mcp/core/event/schema-registry.js";
import { DOMAIN_EVENT_SCHEMA_REGISTRY } from "../mcp/domain/events/index.js";
import { LEARNING_EVENT_TYPES } from "../mcp/domain/events/learning-event-types.js";

describe("EventSchemaRegistry", () => {
  it("injects latest schemaVersion on append validation", () => {
    const registry = new EventSchemaRegistry({
      "sample.event": [
        {
          version: 2,
          schema: z.object({ value: z.string(), schemaVersion: z.literal(2).optional() }).passthrough()
        }
      ]
    });

    const out = registry.validateForAppend("sample.event", { value: "ok" });
    assert.equal(out.schemaVersion, 2);
  });

  it("migrates payload to latest version on read", () => {
    const registry = new EventSchemaRegistry({
      "sample.event": [
        {
          version: 1,
          schema: z.object({ value: z.string(), schemaVersion: z.literal(1).optional() }).passthrough()
        },
        {
          version: 2,
          schema: z.object({ value: z.string(), migrated: z.boolean(), schemaVersion: z.literal(2).optional() }).passthrough(),
          migrateFromPrevious: (input) => ({ ...input, migrated: true, schemaVersion: 2 })
        }
      ]
    });

    const out = registry.migrateForRead("sample.event", { value: "old", schemaVersion: 1 });
    assert.equal(out.schemaVersion, 2);
    assert.equal(out.migrated, true);
  });

  it("validates known learning event payload", () => {
    const registry = new EventSchemaRegistry(DOMAIN_EVENT_SCHEMA_REGISTRY);
    const out = registry.validateForAppend("learning.canary.started", {
      candidateVersion: "v2",
      productionVersion: "v1",
      trafficPercent: 5
    });
    assert.equal(out.schemaVersion, 1);
  });

  it("throws for invalid learning event payload", () => {
    const registry = new EventSchemaRegistry(DOMAIN_EVENT_SCHEMA_REGISTRY);
    assert.throws(() => {
      registry.validateForAppend("learning.promoted", {
        previousVersion: "v1",
        currentVersion: "v2"
      });
    });
  });

  it("covers all learning event types in schema registry", () => {
    const registry = new EventSchemaRegistry(DOMAIN_EVENT_SCHEMA_REGISTRY);
    const samplePayloads: Record<string, Record<string, unknown>> = {
      [LEARNING_EVENT_TYPES.eventAppended]: {
        streamId: "learning-orchestrator:model-a",
        eventType: LEARNING_EVENT_TYPES.canaryStarted,
        version: 1,
        actorId: "actor-1",
        payload: { note: "ok" }
      },
      [LEARNING_EVENT_TYPES.rollbackTriggered]: {
        from: "v2",
        to: "v1",
        alerts: ["drift"]
      },
      [LEARNING_EVENT_TYPES.candidateRejected]: {
        candidateVersion: "v2",
        productionVersion: "v1"
      },
      [LEARNING_EVENT_TYPES.canaryStarted]: {
        candidateVersion: "v2",
        productionVersion: "v1",
        trafficPercent: 5
      },
      [LEARNING_EVENT_TYPES.promotionProposalRequested]: {
        candidateVersion: "v2",
        productionVersion: "v1",
        proposalId: "proposal-1"
      },
      [LEARNING_EVENT_TYPES.promoted]: {
        previousVersion: "v1",
        currentVersion: "v2",
        candidateVersion: "v2",
        canaryTrafficPercent: 5
      }
    };

    for (const eventType of Object.values(LEARNING_EVENT_TYPES)) {
      assert.ok(DOMAIN_EVENT_SCHEMA_REGISTRY[eventType], `missing schema entry for ${eventType}`);
      const validated = registry.validateForAppend(eventType, samplePayloads[eventType]!);
      assert.equal(validated.schemaVersion, 1);
    }
  });
});
