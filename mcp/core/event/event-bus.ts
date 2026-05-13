import { createPostgresNotifyEventBus } from "./backends/postgres-notify.js";
import { getEventBusBackend, getEventBusRedisUrl, getEventBusStreamKey, getPrimaryDatabaseUrl } from "../config/runtime-config.js";
import {
  getActiveTraceContext,
  runWithTraceContext,
  type ActiveTraceContext
} from "../trace/trace-context.js";

export type EventBusBackend = "in-memory" | "postgres-notify" | "redis-streams";

export interface EventBusMessage<TPayload = unknown> {
  topic: string;
  payload: TPayload;
  timestamp: string;
  source?: string;
  traceId?: string;
  traceparent?: string;
}

export type EventBusHandler<TPayload = unknown> =
  (message: EventBusMessage<TPayload>) => Promise<void> | void;

export interface EventBus {
  readonly backend: EventBusBackend;
  publish: <TPayload = unknown>(
    topic: string,
    payload: TPayload,
    options?: { source?: string; timestamp?: string; traceId?: string; traceparent?: string }
  ) => Promise<void>;
  subscribe: <TPayload = unknown>(
    topic: string,
    handler: EventBusHandler<TPayload>
  ) => Promise<() => Promise<void> | void>;
  close: () => Promise<void>;
}

export interface CreateEventBusOptions {
  backend?: EventBusBackend;
  databaseUrl?: string;
  redisUrl?: string;
  channel?: string;
  streamKey?: string;
}

async function createRedisStreamsEventBusLazy(options: { redisUrl: string; streamKey?: string }): Promise<EventBus> {
  const redisModulePath = `./backends/${"redis-streams"}.js`;
  const mod = await import(redisModulePath);
  const factory = mod.createRedisStreamsEventBus as (input: { redisUrl: string; streamKey?: string }) => Promise<EventBus>;
  return factory(options);
}

class InMemoryEventBus implements EventBus {
  public readonly backend: EventBusBackend = "in-memory";
  private subscribers = new Map<string, Set<EventBusHandler>>();

  public async publish<TPayload = unknown>(
    topic: string,
    payload: TPayload,
    options?: { source?: string; timestamp?: string; traceId?: string; traceparent?: string }
  ): Promise<void> {
    const handlers = this.subscribers.get(topic);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const activeTrace = getActiveTraceContext();
    const message: EventBusMessage<TPayload> = {
      topic,
      payload,
      timestamp: options?.timestamp ?? new Date().toISOString(),
      source: options?.source,
      traceId: options?.traceId ?? activeTrace?.traceId,
      traceparent: options?.traceparent ?? activeTrace?.traceparent
    };

    await Promise.all(
      [...handlers].map(async (handler) => {
        const context = message.traceId && message.traceparent
          ? { traceId: message.traceId, traceparent: message.traceparent }
          : undefined;
        if (!context) {
          await handler(message);
          return;
        }
        await Promise.resolve(runWithTraceContext(context as ActiveTraceContext, () => handler(message)));
      })
    );
  }

  public async subscribe<TPayload = unknown>(
    topic: string,
    handler: EventBusHandler<TPayload>
  ): Promise<() => void> {
    const handlers = this.subscribers.get(topic) ?? new Set<EventBusHandler>();
    handlers.add(handler as EventBusHandler);
    this.subscribers.set(topic, handlers);

    return () => {
      const current = this.subscribers.get(topic);
      if (!current) {
        return;
      }
      current.delete(handler as EventBusHandler);
      if (current.size === 0) {
        this.subscribers.delete(topic);
      }
    };
  }

  public async close(): Promise<void> {
    this.subscribers.clear();
  }
}

let globalEventBus: EventBus | null = null;

export async function createEventBus(options: CreateEventBusOptions = {}): Promise<EventBus> {
  const backend = options.backend
    ?? (options.databaseUrl ? "postgres-notify" : "in-memory");

  if (backend === "postgres-notify") {
    if (!options.databaseUrl) {
      throw new Error("databaseUrl is required for postgres-notify backend");
    }
    return createPostgresNotifyEventBus({
      databaseUrl: options.databaseUrl,
      channel: options.channel
    });
  }

  if (backend === "redis-streams") {
    if (!options.redisUrl) {
      throw new Error("redisUrl is required for redis-streams backend");
    }
    return createRedisStreamsEventBusLazy({
      redisUrl: options.redisUrl,
      streamKey: options.streamKey
    });
  }

  return new InMemoryEventBus();
}

export async function getGlobalEventBus(): Promise<EventBus> {
  if (!globalEventBus) {
    const backend = getEventBusBackend();
    globalEventBus = await createEventBus(
      backend === "postgres-notify"
        ? {
            backend,
            databaseUrl: getPrimaryDatabaseUrl() ?? undefined
          }
        : backend === "redis-streams"
          ? {
              backend,
              redisUrl: getEventBusRedisUrl(),
              streamKey: getEventBusStreamKey()
            }
          : {
              backend: "in-memory"
            }
    );
  }
  return globalEventBus;
}

export async function setGlobalEventBus(eventBus: EventBus): Promise<void> {
  if (globalEventBus && globalEventBus !== eventBus) {
    await globalEventBus.close();
  }
  globalEventBus = eventBus;
}
