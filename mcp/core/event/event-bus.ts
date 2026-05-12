import { createPostgresNotifyEventBus } from "./backends/postgres-notify.js";
import { getPrimaryDatabaseUrl } from "../config/runtime-config.js";

export type EventBusBackend = "in-memory" | "postgres-notify";

export interface EventBusMessage<TPayload = unknown> {
  topic: string;
  payload: TPayload;
  timestamp: string;
  source?: string;
}

export type EventBusHandler<TPayload = unknown> =
  (message: EventBusMessage<TPayload>) => Promise<void> | void;

export interface EventBus {
  readonly backend: EventBusBackend;
  publish: <TPayload = unknown>(
    topic: string,
    payload: TPayload,
    options?: { source?: string; timestamp?: string }
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
  channel?: string;
}

class InMemoryEventBus implements EventBus {
  public readonly backend: EventBusBackend = "in-memory";
  private subscribers = new Map<string, Set<EventBusHandler>>();

  public async publish<TPayload = unknown>(
    topic: string,
    payload: TPayload,
    options?: { source?: string; timestamp?: string }
  ): Promise<void> {
    const handlers = this.subscribers.get(topic);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const message: EventBusMessage<TPayload> = {
      topic,
      payload,
      timestamp: options?.timestamp ?? new Date().toISOString(),
      source: options?.source
    };

    await Promise.all(
      [...handlers].map(async (handler) => {
        await handler(message);
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

  return new InMemoryEventBus();
}

export async function getGlobalEventBus(): Promise<EventBus> {
  if (!globalEventBus) {
    globalEventBus = await createEventBus({
      databaseUrl: getPrimaryDatabaseUrl()
    });
  }
  return globalEventBus;
}

export async function setGlobalEventBus(eventBus: EventBus): Promise<void> {
  if (globalEventBus && globalEventBus !== eventBus) {
    await globalEventBus.close();
  }
  globalEventBus = eventBus;
}
