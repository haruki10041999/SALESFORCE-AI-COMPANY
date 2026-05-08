/**
 * T-07: Online Policy Hook – Policy Snapshot
 *
 * 軽量なメモリ内キャッシュとして最新の bandit posterior / reputation を保持し、
 * dequeue_next_agent などの意思決定パスが常に最新 posterior を参照できるようにする。
 *
 * Postgres 環境では LISTEN/NOTIFY (`policy_updated` チャネル) を購読し、
 * 他インスタンスが posterior を更新した際も全インスタンスに即時伝播する。
 * SQLite / in-memory 環境では LISTEN 不使用でローカルキャッシュのみで動く。
 *
 * onlineMode:
 *   'live'   – 学習済み posterior を意思決定に反映する（本番）
 *   'shadow' – 観測のみ行い意思決定には影響させない（安全実験中）
 */

import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import type { LinUcbState } from "./lin-ucb-bandit.js";
import { createLinUcbState, fromLinUcbSnapshot } from "./lin-ucb-bandit.js";
import { loadAgentReputationRecords, computeAgentReputationScore } from "./agent-reputation.js";
import { selectAgentWithPolicyMixer, type PolicyMixerOutput } from "./bandit-orchestration-policy.js";
import { isDriftFreezeActiveSync } from "./drift-freeze.js";

export type OnlineLearningMode = "live" | "shadow";

export interface PolicySnapshotOptions {
  banditStateFile: string;
  agentReputationFile: string;
  databaseUrl?: string;
  onlineMode?: OnlineLearningMode;
  /** Minimum ms between two consecutive full refreshes triggered by NOTIFY. Default: 200 */
  debounceMs?: number;
}

export interface PolicySnapshot {
  version: number;
  refreshedAt: string;
  banditState: LinUcbState;
  reputationRecords: Awaited<ReturnType<typeof loadAgentReputationRecords>>;
}

const POLICY_NOTIFY_CHANNEL = "policy_updated";

function resolveOnlineMode(env: NodeJS.ProcessEnv = process.env): OnlineLearningMode {
  if (isDriftFreezeActiveSync(env)) {
    return "shadow";
  }
  const raw = (env.SF_AI_LEARNING_MODE ?? "live").trim().toLowerCase();
  return raw === "shadow" ? "shadow" : "live";
}

export class PolicySnapshotManager extends EventEmitter {
  private readonly banditStateFile: string;
  private readonly agentReputationFile: string;
  private readonly databaseUrl?: string;
  private readonly onlineMode: OnlineLearningMode;
  private readonly debounceMs: number;

  private snapshot: PolicySnapshot | null = null;
  private refreshPending = false;
  private refreshTimer: NodeJS.Timeout | null = null;
  private pgClient: import("pg").Client | null = null;
  private listenActive = false;
  private version = 0;

  public constructor(options: PolicySnapshotOptions) {
    super();
    this.banditStateFile = options.banditStateFile;
    this.agentReputationFile = options.agentReputationFile;
    this.databaseUrl = options.databaseUrl;
    this.onlineMode = options.onlineMode ?? resolveOnlineMode();
    this.debounceMs = options.debounceMs ?? 200;
  }

  /** Start background LISTEN. Safe to call multiple times. */
  public async start(): Promise<void> {
    if (this.listenActive) {
      return;
    }
    await this.refresh();
    if (this.databaseUrl) {
      await this.startListen();
    }
  }

  /** Force a full refresh from disk/DB. Returns the new snapshot version. */
  public async refresh(): Promise<number> {
    const [linUcbSnapshot, reputationRecords] = await Promise.all([
      this.loadLinUcbState().catch(() => null),
      loadAgentReputationRecords(this.agentReputationFile).catch(() => [])
    ]);

    const banditState = linUcbSnapshot ?? createLinUcbState(1);

    this.version += 1;
    this.snapshot = {
      version: this.version,
      refreshedAt: new Date().toISOString(),
      banditState,
      reputationRecords
    };
    this.emit("refreshed", this.snapshot);
    return this.version;
  }

  /** Debounced refresh – safe to call on every feedback write without hammering disk/DB. */
  public scheduleRefresh(): void {
    if (this.refreshPending) {
      return;
    }
    this.refreshPending = true;
    this.refreshTimer = setTimeout(() => {
      this.refreshPending = false;
      this.refreshTimer = null;
      void this.refresh();
    }, this.debounceMs);
  }

  /** Send NOTIFY so other instances pick up the change. No-op when not using Postgres. */
  public async notifyPolicyUpdated(): Promise<void> {
    if (!this.databaseUrl) {
      return;
    }
    try {
      const { Client } = await import("pg");
      const client = new Client({ connectionString: this.databaseUrl });
      await client.connect();
      await client.query(`NOTIFY ${POLICY_NOTIFY_CHANNEL}, '${this.version}'`);
      await client.end();
    } catch {
      // Notify failure is non-fatal – local refresh already happened
    }
  }

  /** Current snapshot. Null only before first refresh. */
  public get current(): PolicySnapshot | null {
    return this.snapshot;
  }

  /** Current online mode (live or shadow). */
  public get mode(): OnlineLearningMode {
    return this.onlineMode;
  }

  /** Whether online mode is live (i.e. decisions should be influenced). */
  public get isLive(): boolean {
    return this.onlineMode === "live";
  }

  /**
   * Select the best agent from `candidates` using the latest posterior.
   * Returns `null` in shadow mode (caller should use its own ordering).
   */
  public async selectAgent(input: {
    candidates: string[];
    topic: string;
    fromAgent?: string;
    rng?: () => number;
  }): Promise<(PolicyMixerOutput & { snapshotVersion: number }) | null> {
    if (!this.isLive) {
      return null;
    }

    const snap = this.snapshot;
    if (!snap || input.candidates.length === 0) {
      return null;
    }

    try {
      const result = await selectAgentWithPolicyMixer({
        candidates: input.candidates,
        topic: input.topic,
        fromAgent: input.fromAgent,
        banditState: snap.banditState,
        forcedExplorationRate: resolveExplorationRate(),
        rng: input.rng
      });
      return { ...result, snapshotVersion: snap.version };
    } catch {
      return null;
    }
  }

  /**
   * Compute reputation-weighted priority scores for a list of agents.
   * Returns a Map<agentName, score> for use in queue reordering.
   */
  public reputationScores(agents: string[], topic: string): Map<string, number> {
    const snap = this.snapshot;
    const scores = new Map<string, number>();
    if (!snap) {
      for (const agent of agents) {
        scores.set(agent, 0.5);
      }
      return scores;
    }
    for (const agent of agents) {
      const global = computeAgentReputationScore(snap.reputationRecords, agent, "global", "global", 0.5);
      const topicScore = computeAgentReputationScore(snap.reputationRecords, agent, "topic", topic, 0.5);
      scores.set(agent, (global * 0.5) + (topicScore * 0.5));
    }
    return scores;
  }

  public async close(): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.pgClient) {
      try {
        await this.pgClient.query(`UNLISTEN ${POLICY_NOTIFY_CHANNEL}`);
        await this.pgClient.end();
      } catch {
        // ignore cleanup errors
      }
      this.pgClient = null;
    }
    this.listenActive = false;
  }

  private async loadLinUcbState(): Promise<LinUcbState | null> {
    try {
      const raw = await readFile(this.banditStateFile, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || !("dimension" in parsed)) {
        return null;
      }
      return fromLinUcbSnapshot(parsed as Parameters<typeof fromLinUcbSnapshot>[0]);
    } catch {
      return null;
    }
  }

  private async startListen(): Promise<void> {
    if (!this.databaseUrl || this.listenActive) {
      return;
    }
    try {
      const { Client } = await import("pg");
      const client = new Client({ connectionString: this.databaseUrl });
      await client.connect();
      this.pgClient = client;

      client.on("notification", () => {
        this.scheduleRefresh();
      });
      client.on("error", () => {
        this.listenActive = false;
        this.pgClient = null;
        // Attempt reconnect after a short delay
        setTimeout(() => {
          void this.startListen();
        }, 5000);
      });

      await client.query(`LISTEN ${POLICY_NOTIFY_CHANNEL}`);
      this.listenActive = true;
    } catch {
      // LISTEN startup failure is non-fatal – local cache still works
    }
  }
}

function resolveExplorationRate(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number.parseFloat(env.SF_AI_EXPLORATION_RATE ?? "0.05");
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
    return 0.05;
  }
  return raw;
}

/** Singleton-like factory: creates one manager per process (call close() when done). */
export function createPolicySnapshotManager(options: PolicySnapshotOptions): PolicySnapshotManager {
  return new PolicySnapshotManager(options);
}
