import { test } from "node:test";
import { strict as assert } from "node:assert";
import { promises as fsPromises } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RewardRecord } from "../mcp/core/types/feedback.js";
import { runMetricsAutoUpdate } from "../mcp/core/learning/metrics-auto-update.js";
import {
  createModelRegistry,
  registerModelVersion,
  recordOutcome,
  setShadowVersion,
  toSnapshot
} from "../mcp/core/learning/model-registry.js";
import type {
  AppendEventInput,
  EventHandler,
  EventStore,
  ReadEventsOptions,
  StoredEvent,
  SubscribeOptions
} from "../mcp/core/ports/event-store.js";

const TMP_DIR = resolve("outputs", "learning", "metrics-auto-update-test");
const REWARD_PATH = resolve(TMP_DIR, "rewards.jsonl");
const REPUTATION_PATH = resolve(TMP_DIR, "agent-reputation.jsonl");
const REPORT_PATH = resolve(TMP_DIR, "drift-report.jsonl");
const FREEZE_PATH = resolve(TMP_DIR, "drift-freeze.json");
const LEARNING_SNAPSHOT_PATH = resolve(TMP_DIR, "learning-registry.snapshot.json");
const LEARNING_REPORT_PATH = resolve(TMP_DIR, "learning-orchestrator-latest.json");
const LEARNING_CANARY_STATE_PATH = resolve(TMP_DIR, "learning-canary-state.json");

async function writeJsonl(filePath: string, rows: unknown[]): Promise<void> {
  await fsPromises.mkdir(dirname(filePath), { recursive: true });
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  await fsPromises.writeFile(filePath, content.length > 0 ? `${content}\n` : "", "utf-8");
}

function makeReward(hoursAgo: number, reward: number, agentName = "agent-a"): RewardRecord {
  return {
    rewardId: `r-${Math.random().toString(36).slice(2)}`,
    source: "test",
    reward,
    confidence: 1,
    agentName,
    timestamp: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString()
  };
}

async function cleanup(): Promise<void> {
  await fsPromises.rm(TMP_DIR, { recursive: true, force: true });
}

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

test("metrics-auto-update emits drift alert callback when alert is detected", async () => {
  await cleanup();
  try {
    const rewards: RewardRecord[] = [];
    for (let i = 0; i < 30; i++) rewards.push(makeReward(40 + i, 0.85));
    for (let i = 0; i < 30; i++) rewards.push(makeReward(i % 20, 0.2));
    await writeJsonl(REWARD_PATH, rewards);
    await writeJsonl(REPUTATION_PATH, []);

    let callbackCount = 0;
    const result = await runMetricsAutoUpdate({
      reportingHours: 24,
      includeDriftDetection: true,
      driftBaselineHours: 72,
      driftRecentHours: 24,
      minRecentRewardSamples: 20,
      rewardDriftThreshold: 0.15,
      rewardFilePath: REWARD_PATH,
      reputationFilePath: REPUTATION_PATH,
      driftReportPath: REPORT_PATH,
      freezeStatePath: FREEZE_PATH,
      onDriftAlert: () => {
        callbackCount += 1;
      }
    });

    assert.equal(result.driftReport?.shouldAlert, true);
    assert.equal(result.driftAlertEmitted, true);
    assert.equal(result.driftFreezeActivated, true);
    assert.equal(callbackCount, 1);
    const freezePayload = JSON.parse(await fsPromises.readFile(FREEZE_PATH, "utf-8")) as {
      frozen?: boolean;
      sourceReportId?: string;
    };
    assert.equal(freezePayload.frozen, true);
    assert.equal(freezePayload.sourceReportId, result.driftReport?.reportId);
  } finally {
    await cleanup();
  }
});

test("metrics-auto-update does not emit drift callback when alert is not detected", async () => {
  await cleanup();
  try {
    const rewards: RewardRecord[] = [];
    for (let i = 0; i < 30; i++) rewards.push(makeReward(40 + i, 0.5));
    for (let i = 0; i < 30; i++) rewards.push(makeReward(i % 20, 0.52));
    await writeJsonl(REWARD_PATH, rewards);
    await writeJsonl(REPUTATION_PATH, []);

    let callbackCount = 0;
    const result = await runMetricsAutoUpdate({
      reportingHours: 24,
      includeDriftDetection: true,
      driftBaselineHours: 72,
      driftRecentHours: 24,
      minRecentRewardSamples: 20,
      rewardDriftThreshold: 0.2,
      rewardFilePath: REWARD_PATH,
      reputationFilePath: REPUTATION_PATH,
      driftReportPath: REPORT_PATH,
      freezeStatePath: FREEZE_PATH,
      onDriftAlert: () => {
        callbackCount += 1;
      }
    });

    assert.equal(result.driftReport?.shouldAlert, false);
    assert.equal(result.driftAlertEmitted, false);
    assert.equal(result.driftFreezeActivated, false);
    assert.equal(callbackCount, 0);
    await assert.rejects(async () => fsPromises.readFile(FREEZE_PATH, "utf-8"));
  } finally {
    await cleanup();
  }
});

test("metrics-auto-update can disable drift freeze activation", async () => {
  await cleanup();
  try {
    const rewards: RewardRecord[] = [];
    for (let i = 0; i < 30; i++) rewards.push(makeReward(40 + i, 0.9));
    for (let i = 0; i < 30; i++) rewards.push(makeReward(i % 20, 0.1));
    await writeJsonl(REWARD_PATH, rewards);
    await writeJsonl(REPUTATION_PATH, []);

    const result = await runMetricsAutoUpdate({
      reportingHours: 24,
      includeDriftDetection: true,
      driftBaselineHours: 72,
      driftRecentHours: 24,
      minRecentRewardSamples: 20,
      rewardDriftThreshold: 0.15,
      rewardFilePath: REWARD_PATH,
      reputationFilePath: REPUTATION_PATH,
      driftReportPath: REPORT_PATH,
      freezeOnDriftAlert: false,
      freezeStatePath: FREEZE_PATH
    });

    assert.equal(result.driftReport?.shouldAlert, true);
    assert.equal(result.driftFreezeActivated, false);
    await assert.rejects(async () => fsPromises.readFile(FREEZE_PATH, "utf-8"));
  } finally {
    await cleanup();
  }
});

test("metrics-auto-update supports adaptive drift threshold options", async () => {
  await cleanup();
  try {
    const rewards: RewardRecord[] = [
      makeReward(40, 0.1),
      makeReward(41, 0.9),
      makeReward(42, 0.2),
      makeReward(43, 0.8),
      makeReward(2, 0.4),
      makeReward(3, 0.9),
      makeReward(4, 0.3),
      makeReward(5, 0.8)
    ];
    await writeJsonl(REWARD_PATH, rewards);
    await writeJsonl(REPUTATION_PATH, []);

    const result = await runMetricsAutoUpdate({
      reportingHours: 24,
      includeDriftDetection: true,
      driftBaselineHours: 72,
      driftRecentHours: 24,
      minRecentRewardSamples: 4,
      rewardDriftThreshold: 0.15,
      adaptiveRewardDriftThreshold: true,
      rewardFilePath: REWARD_PATH,
      reputationFilePath: REPUTATION_PATH,
      driftReportPath: REPORT_PATH
    });

    assert.ok(result.driftReport);
    assert.equal(result.driftReport?.rewardDrift.adaptiveThresholdEnabled, true);
    assert.ok((result.driftReport?.rewardDrift.effectiveDriftThreshold ?? 0) >= 0.15);
  } finally {
    await cleanup();
  }
});

test("metrics-auto-update runs learning orchestrator batch from snapshot", async () => {
  await cleanup();
  try {
    const registry = createModelRegistry();
    registerModelVersion<number, number>(registry, { name: "ranker", version: "v1", predict: (value) => value + 1 });
    registerModelVersion<number, number>(registry, { name: "ranker", version: "v2", predict: (value) => value + 2 });
    setShadowVersion(registry, "ranker", "v2");
    for (let i = 0; i < 40; i++) {
      recordOutcome(registry, "ranker", "v2", "shadow");
    }
    await fsPromises.mkdir(dirname(LEARNING_SNAPSHOT_PATH), { recursive: true });
    await fsPromises.writeFile(LEARNING_SNAPSHOT_PATH, JSON.stringify(toSnapshot(registry), null, 2), "utf-8");

    const result = await runMetricsAutoUpdate({
      reportingHours: 24,
      includeDriftDetection: false,
      learningOrchestratorEnabled: true,
      learningSnapshotPath: LEARNING_SNAPSHOT_PATH,
      learningModelNames: ["ranker"],
      learningCanaryStatePath: LEARNING_CANARY_STATE_PATH,
      learningCanaryTrafficPercent: 5,
      learningReportPath: LEARNING_REPORT_PATH
    });

    assert.equal(result.learningOrchestratorResults?.length, 1);
    assert.equal(result.learningOrchestratorResults?.[0]?.stage, "canary");

    const canaryState = JSON.parse(await fsPromises.readFile(LEARNING_CANARY_STATE_PATH, "utf-8")) as Record<string, string>;
    assert.equal(canaryState.ranker, "v2");

    const report = JSON.parse(await fsPromises.readFile(LEARNING_REPORT_PATH, "utf-8")) as {
      models: string[];
      results: Array<{ stage: string }>;
    };
    assert.deepEqual(report.models, ["ranker"]);
    assert.equal(report.results[0]?.stage, "canary");
  } finally {
    await cleanup();
  }
});

test("metrics-auto-update reuses persisted canary state when explicit map is not passed", async () => {
  await cleanup();
  try {
    const registry = createModelRegistry();
    registerModelVersion<number, number>(registry, { name: "ranker", version: "v1", predict: (value) => value + 1 });
    registerModelVersion<number, number>(registry, { name: "ranker", version: "v2", predict: (value) => value + 2 });
    setShadowVersion(registry, "ranker", "v2");
    for (let i = 0; i < 40; i++) {
      recordOutcome(registry, "ranker", "v2", "shadow");
    }
    await fsPromises.mkdir(dirname(LEARNING_SNAPSHOT_PATH), { recursive: true });
    await fsPromises.writeFile(LEARNING_SNAPSHOT_PATH, JSON.stringify(toSnapshot(registry), null, 2), "utf-8");

    // First run records canary state.
    await runMetricsAutoUpdate({
      reportingHours: 24,
      includeDriftDetection: false,
      learningOrchestratorEnabled: true,
      learningSnapshotPath: LEARNING_SNAPSHOT_PATH,
      learningModelNames: ["ranker"],
      learningCanaryStatePath: LEARNING_CANARY_STATE_PATH
    });

    let queueCalls = 0;
    const secondRun = await runMetricsAutoUpdate({
      reportingHours: 24,
      includeDriftDetection: false,
      learningOrchestratorEnabled: true,
      learningSnapshotPath: LEARNING_SNAPSHOT_PATH,
      learningModelNames: ["ranker"],
      learningCanaryStatePath: LEARNING_CANARY_STATE_PATH,
      learningManualApprovalRequired: true,
      learningQueueProposal: async (input) => {
        queueCalls += 1;
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
    });

    assert.equal(queueCalls, 1);
    assert.equal(secondRun.learningOrchestratorResults?.[0]?.stage, "proposal_required");
  } finally {
    await cleanup();
  }
});

test("metrics-auto-update forwards queueProposal when manual approval is required", async () => {
  await cleanup();
  try {
    const registry = createModelRegistry();
    registerModelVersion<number, number>(registry, { name: "ranker", version: "v1", predict: (value) => value + 1 });
    registerModelVersion<number, number>(registry, { name: "ranker", version: "v2", predict: (value) => value + 2 });
    setShadowVersion(registry, "ranker", "v2");
    for (let i = 0; i < 40; i++) {
      recordOutcome(registry, "ranker", "v2", "shadow");
    }
    await fsPromises.mkdir(dirname(LEARNING_SNAPSHOT_PATH), { recursive: true });
    await fsPromises.writeFile(LEARNING_SNAPSHOT_PATH, JSON.stringify(toSnapshot(registry), null, 2), "utf-8");

    let queueCalls = 0;
    const result = await runMetricsAutoUpdate({
      reportingHours: 24,
      includeDriftDetection: false,
      learningOrchestratorEnabled: true,
      learningSnapshotPath: LEARNING_SNAPSHOT_PATH,
      learningModelNames: ["ranker"],
      learningCurrentCanaryVersions: { ranker: "v2" },
      learningManualApprovalRequired: true,
      learningQueueProposal: async (input) => {
        queueCalls += 1;
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
    });

    assert.equal(queueCalls, 1);
    assert.equal(result.learningOrchestratorResults?.[0]?.stage, "proposal_required");
  } finally {
    await cleanup();
  }
});

test("metrics-auto-update forwards learningEventStore to orchestrator", async () => {
  await cleanup();
  try {
    const registry = createModelRegistry();
    registerModelVersion<number, number>(registry, { name: "ranker", version: "v1", predict: (value) => value + 1 });
    registerModelVersion<number, number>(registry, { name: "ranker", version: "v2", predict: (value) => value + 2 });
    setShadowVersion(registry, "ranker", "v2");
    for (let i = 0; i < 40; i++) {
      recordOutcome(registry, "ranker", "v2", "shadow");
    }
    await fsPromises.mkdir(dirname(LEARNING_SNAPSHOT_PATH), { recursive: true });
    await fsPromises.writeFile(LEARNING_SNAPSHOT_PATH, JSON.stringify(toSnapshot(registry), null, 2), "utf-8");

    const eventStore = new MemoryEventStore();
    const result = await runMetricsAutoUpdate({
      reportingHours: 24,
      includeDriftDetection: false,
      learningOrchestratorEnabled: true,
      learningSnapshotPath: LEARNING_SNAPSHOT_PATH,
      learningModelNames: ["ranker"],
      learningEventStore: eventStore
    });

    assert.equal(result.learningOrchestratorResults?.[0]?.eventRecorded, true);
    const events = await eventStore.read("learning-orchestrator:ranker");
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, "learning.canary.started");
  } finally {
    await cleanup();
  }
});
