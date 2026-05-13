import { createHash } from "node:crypto";
import { PgBoss } from "pg-boss";
import { currentTenantId } from "../../core/identity/tenant-context.js";

export interface OrchestrationQueueStore {
  readonly backend: "in-memory" | "pg-boss";
  replace(sessionId: string, queue: string[]): Promise<void>;
  enqueue(sessionId: string, agents: string[]): Promise<void>;
  dequeue(sessionId: string, limit: number): Promise<string[]>;
  clear(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

class InMemoryOrchestrationQueueStore implements OrchestrationQueueStore {
  public readonly backend = "in-memory" as const;
  private readonly queues = new Map<string, string[]>();

  private key(sessionId: string): string {
    const tenant = currentTenantId() ?? "__global";
    return `${tenant}:${sessionId}`;
  }

  public async replace(sessionId: string, queue: string[]): Promise<void> {
    this.queues.set(this.key(sessionId), [...queue]);
  }

  public async enqueue(sessionId: string, agents: string[]): Promise<void> {
    if (agents.length === 0) {
      return;
    }
    const current = this.queues.get(this.key(sessionId)) ?? [];
    current.push(...agents);
    this.queues.set(this.key(sessionId), current);
  }

  public async dequeue(sessionId: string, limit: number): Promise<string[]> {
    const key = this.key(sessionId);
    const current = this.queues.get(key) ?? [];
    if (current.length === 0) {
      return [];
    }
    const next = current.splice(0, Math.max(1, limit));
    this.queues.set(key, current);
    return next;
  }

  public async clear(sessionId: string): Promise<void> {
    this.queues.delete(this.key(sessionId));
  }

  public async close(): Promise<void> {
    this.queues.clear();
  }
}

interface OrchestrationJobPayload {
  sessionId: string;
  agentName: string;
  position: number;
  enqueuedAt: string;
}

export interface PgBossOrchestrationQueueStoreOptions {
  databaseUrl: string;
  queuePrefix?: string;
}

class PgBossOrchestrationQueueStore implements OrchestrationQueueStore {
  public readonly backend = "pg-boss" as const;
  private readonly boss: PgBoss;
  private readonly queuePrefix: string;
  private readonly ensuredQueues = new Set<string>();

  private constructor(boss: PgBoss, queuePrefix: string) {
    this.boss = boss;
    this.queuePrefix = queuePrefix;
  }

  public static async open(options: PgBossOrchestrationQueueStoreOptions): Promise<PgBossOrchestrationQueueStore> {
    const boss = new PgBoss(options.databaseUrl);
    await boss.start();
    return new PgBossOrchestrationQueueStore(boss, options.queuePrefix ?? "orchestration-session");
  }

  public async replace(sessionId: string, queue: string[]): Promise<void> {
    const queueName = await this.ensureQueue(sessionId);
    await this.boss.deleteQueuedJobs(queueName);
    if (queue.length === 0) {
      return;
    }
    for (const [index, agentName] of queue.entries()) {
      await this.boss.send(queueName, {
        sessionId,
        agentName,
        position: index,
        enqueuedAt: new Date().toISOString()
      } satisfies OrchestrationJobPayload);
    }
  }

  public async enqueue(sessionId: string, agents: string[]): Promise<void> {
    if (agents.length === 0) {
      return;
    }
    const queueName = await this.ensureQueue(sessionId);
    for (const [index, agentName] of agents.entries()) {
      await this.boss.send(queueName, {
        sessionId,
        agentName,
        position: index,
        enqueuedAt: new Date().toISOString()
      } satisfies OrchestrationJobPayload);
    }
  }

  public async dequeue(sessionId: string, limit: number): Promise<string[]> {
    const queueName = await this.ensureQueue(sessionId);
    const jobs = await this.boss.fetch<OrchestrationJobPayload>(queueName, { batchSize: Math.max(1, limit) });
    if (jobs.length === 0) {
      return [];
    }
    await this.boss.complete(queueName, jobs.map((job) => job.id));
    return jobs
      .map((job) => job.data?.agentName)
      .filter((agentName): agentName is string => typeof agentName === "string" && agentName.length > 0);
  }

  public async clear(sessionId: string): Promise<void> {
    const queueName = await this.ensureQueue(sessionId);
    await this.boss.deleteQueuedJobs(queueName);
  }

  public async close(): Promise<void> {
    await this.boss.stop();
  }

  private async ensureQueue(sessionId: string): Promise<string> {
    const queueName = this.queueNameForSession(sessionId);
    if (this.ensuredQueues.has(queueName)) {
      return queueName;
    }
    try {
      await this.boss.createQueue(queueName);
    } catch {
      // Queue may already exist.
    }
    this.ensuredQueues.add(queueName);
    return queueName;
  }

  private queueNameForSession(sessionId: string): string {
    const tenant = currentTenantId() ?? "__global";
    const digest = createHash("sha1").update(`${tenant}:${sessionId}`).digest("hex").slice(0, 12);
    return `${this.queuePrefix}-${digest}`;
  }
}

export async function createOrchestrationQueueStore(options: {
  stateBackend?: string;
  databaseUrl?: string;
  queuePrefix?: string;
}): Promise<OrchestrationQueueStore> {
  if (options.stateBackend === "postgres" && options.databaseUrl) {
    return PgBossOrchestrationQueueStore.open({
      databaseUrl: options.databaseUrl,
      queuePrefix: options.queuePrefix
    });
  }
  return new InMemoryOrchestrationQueueStore();
}