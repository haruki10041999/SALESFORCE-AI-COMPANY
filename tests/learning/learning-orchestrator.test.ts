import { strict as assert } from "node:assert";
import test from "node:test";
import {
  createModelRegistry,
  registerModelVersion,
  restoreRegistryFromSnapshot,
  setShadowVersion,
  toSnapshot,
  recordOutcome
} from "../../mcp/core/learning/model-registry.js";
import { runLearningOrchestrator } from "../../mcp/core/learning/learning-orchestrator.js";
import { runLearningPromotionWorkflow } from "../../mcp/core/orchestration/workflows/learning-promotion.workflow.js";
import type {
  AppendEventInput,
  EventHandler,
  EventStore,
  ReadEventsOptions,
  StoredEvent,
  SubscribeOptions
} from "../../mcp/core/ports/event-store.js";
import type { NewProposalInput, ProposalRecord } from "../../mcp/core/resource/proposal/queue.js";

class MemoryEventStore implements EventStore {
  private readonly events = new Map<string, StoredEvent[]>();
  private globalSeq = 0;

  async append(input: AppendEventInput): Promise<StoredEvent> {
    const stream = this.events.get(input.streamId) ?? [];
    const actualVersion = stream.length;
    if (actualVersion !== input.expectedVersion) {
      throw new Error(`unexpected version ${actualVersion}`);
    }
    const event: StoredEvent = {
      id: this.globalSeq + 1,
      globalSeq: this.globalSeq + 1,
      version: actualVersion,
      status: "active",
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      streamId: input.streamId,
      eventType: input.eventType,
      tenantId: input.tenantId,
      actorId: input.actorId,
      payload: input.payload
    };
    this.globalSeq += 1;
    this.events.set(input.streamId, [...stream, event]);
    return event;
  }

  async read(streamId: string, _options?: ReadEventsOptions): Promise<StoredEvent[]> {
    return [...(this.events.get(streamId) ?? [])];
  }

  subscribe(_handler: EventHandler, _options?: SubscribeOptions): () => void {
    return () => undefined;
  }

  async tombstone(_id: number): Promise<void> {
    return;
  }
}

function buildRegistry() {
  const registry = createModelRegistry();
  registerModelVersion<number, number>(registry, { name: "ranker", version: "v1", predict: (value) => value + 1 });
  registerModelVersion<number, number>(registry, { name: "ranker", version: "v2", predict: (value) => value + 2 });
  setShadowVersion(registry, "ranker", "v2");
  for (let i = 0; i < 40; i++) {
    recordOutcome(registry, "ranker", "v2", "shadow");
  }
  return registry;
}

function createQueuedProposal(input: NewProposalInput): ProposalRecord {
  return {
    id: "prop-1",
    resourceType: input.resourceType,
    name: input.name,
    content: input.content,
    confidence: input.confidence ?? 0,
    sourceEvent: input.sourceEvent,
    origin: input.origin,
    createdByActorId: input.createdByActorId,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "pending",
    approval: {
      requiredStages: input.requiredApprovalStages ?? ["reviewer", "admin"],
      currentStage: (input.requiredApprovalStages ?? ["reviewer", "admin"])[0],
      completedStages: [],
      history: []
    }
  };
}

test("restoreRegistryFromSnapshot rebuilds registry metadata", () => {
  const snapshot = toSnapshot(buildRegistry());
  const restored = restoreRegistryFromSnapshot(snapshot);
  const entry = restored.get("ranker");
  assert.ok(entry);
  assert.equal(entry?.productionVersion, "v1");
  assert.ok(entry?.versions.has("v2"));
  assert.ok(entry?.shadowVersions.has("v2"));
});

test("runLearningOrchestrator starts canary and records event when candidate is ready", async () => {
  const registry = buildRegistry();
  const eventStore = new MemoryEventStore();

  const result = await runLearningOrchestrator(
    {
      registry,
      modelName: "ranker"
    },
    { eventStore }
  );

  assert.equal(result.stage, "canary");
  assert.equal(result.action, "start_canary");
  assert.equal(result.candidateVersion, "v2");
  const events = await eventStore.read("learning-orchestrator:ranker");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventType, "learning.canary.started");
});

test("runLearningOrchestrator queues proposal after canary when manual approval is required", async () => {
  const registry = buildRegistry();
  const queued: NewProposalInput[] = [];

  const result = await runLearningOrchestrator(
    {
      registry,
      modelName: "ranker",
      currentCanaryVersion: "v2",
      manualApprovalRequired: true,
      actorId: "qa-engineer"
    },
    {
      queueProposal: async (input) => {
        queued.push(input);
        return createQueuedProposal(input);
      }
    }
  );

  assert.equal(result.stage, "proposal_required");
  assert.equal(result.action, "queue_proposal");
  assert.equal(result.proposalId, "prop-1");
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.resourceType, "presets");
});

test("runLearningPromotionWorkflow promotes approved canary candidate", async () => {
  const registry = buildRegistry();
  const result = await runLearningPromotionWorkflow({
    registrySnapshot: toSnapshot(registry),
    modelName: "ranker",
    currentCanaryVersion: "v2",
    manualApprovalRequired: true,
    manualOverride: "approve"
  });

  assert.equal(result.stage, "promoted");
  assert.equal(result.action, "promote");
  assert.equal(result.currentProductionVersion, "v2");
  assert.equal(result.previousVersion, "v1");
  assert.ok(result.dag.some((node) => node.node === "promotion" && node.status === "passed"));
});

test("runLearningPromotionWorkflow tags policy snapshot on successful promotion", async () => {
  const registry = buildRegistry();
  const result = await runLearningPromotionWorkflow(
    {
      registrySnapshot: toSnapshot(registry),
      modelName: "ranker",
      currentCanaryVersion: "v2",
      manualApprovalRequired: true,
      manualOverride: "approve"
    },
    {
      createPolicySnapshotTag: async () => "policy-snapshot:ranker@v2"
    }
  );

  assert.equal(result.stage, "promoted");
  assert.equal(result.policySnapshotTag, "policy-snapshot:ranker@v2");
  assert.ok(result.dag.some((node) => node.node === "policy-snapshot" && node.status === "passed"));
});

test("runLearningPromotionWorkflow rolls back when policy snapshot tagging fails", async () => {
  const registry = buildRegistry();
  const result = await runLearningPromotionWorkflow(
    {
      registrySnapshot: toSnapshot(registry),
      modelName: "ranker",
      currentCanaryVersion: "v2",
      manualApprovalRequired: true,
      manualOverride: "approve"
    },
    {
      createPolicySnapshotTag: async () => {
        throw new Error("tag-service-down");
      }
    }
  );

  assert.equal(result.stage, "rolled_back");
  assert.equal(result.action, "rollback");
  assert.equal(result.currentProductionVersion, "v1");
  assert.equal(result.promotionRolledBack, true);
  assert.ok(result.reason.includes("snapshot-tag-failed"));
  assert.ok(result.dag.some((node) => node.node === "policy-snapshot" && node.status === "failed"));
});

test("runLearningPromotionWorkflow records promotion history hook payload", async () => {
  const registry = buildRegistry();
  const history: Array<{
    modelName: string;
    stage: string;
    action: string;
    policySnapshotTag?: string;
    dag: Array<{ node: string; status: string }>;
  }> = [];

  const result = await runLearningPromotionWorkflow(
    {
      registrySnapshot: toSnapshot(registry),
      modelName: "ranker",
      currentCanaryVersion: "v2",
      manualApprovalRequired: true,
      manualOverride: "approve"
    },
    {
      createPolicySnapshotTag: async () => "policy-snapshot:ranker@v2",
      recordPromotionHistory: async (entry) => {
        history.push({
          modelName: entry.modelName,
          stage: entry.stage,
          action: entry.action,
          policySnapshotTag: entry.policySnapshotTag,
          dag: entry.dag.map((node) => ({ node: node.node, status: node.status }))
        });
      }
    }
  );

  assert.equal(result.stage, "promoted");
  assert.equal(history.length, 1);
  assert.equal(history[0]?.modelName, "ranker");
  assert.equal(history[0]?.action, "promote");
  assert.equal(history[0]?.policySnapshotTag, "policy-snapshot:ranker@v2");
  assert.ok(history[0]?.dag.some((node) => node.node === "promotion" && node.status === "passed"));
});

test("runLearningOrchestrator rolls back on drift alert when history exists", async () => {
  const registry = buildRegistry();
  await runLearningOrchestrator({
    registry,
    modelName: "ranker",
    currentCanaryVersion: "v2",
    manualApprovalRequired: false,
    manualOverride: "approve"
  });

  const result = await runLearningOrchestrator({
    registry,
    modelName: "ranker",
    driftReport: {
      shouldAlert: true,
      alerts: ["reward regression"]
    }
  });

  assert.equal(result.stage, "rolled_back");
  assert.equal(result.action, "rollback");
  assert.equal(result.currentProductionVersion, "v1");
  assert.equal(result.previousVersion, "v2");
});
