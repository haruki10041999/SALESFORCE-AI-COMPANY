import { Client } from "pg";
import {
  type EventBus,
  type EventBusHandler,
  type EventBusMessage
} from "../event-bus.js";

const DEFAULT_CHANNEL = "sfai_event_bus";
const MAX_NOTIFY_PAYLOAD_BYTES = 7900;

interface CreatePostgresNotifyEventBusOptions {
  databaseUrl: string;
  channel?: string;
}

function assertSafeChannel(channel: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(channel)) {
    throw new Error(`Invalid postgres notify channel: ${channel}`);
  }
}

function encodeMessage(message: EventBusMessage): string {
  const raw = JSON.stringify(message);
  if (Buffer.byteLength(raw, "utf-8") > MAX_NOTIFY_PAYLOAD_BYTES) {
    throw new Error("event bus payload exceeds postgres NOTIFY payload size");
  }
  return raw.replace(/'/g, "''");
}

function decodeMessage(raw: string): EventBusMessage | null {
  try {
    const parsed = JSON.parse(raw) as Partial<EventBusMessage>;
    if (
      typeof parsed?.topic !== "string"
      || typeof parsed?.timestamp !== "string"
    ) {
      return null;
    }
    return {
      topic: parsed.topic,
      payload: parsed.payload,
      timestamp: parsed.timestamp,
      source: typeof parsed.source === "string" ? parsed.source : undefined
    };
  } catch {
    return null;
  }
}

class PostgresNotifyEventBus implements EventBus {
  public readonly backend = "postgres-notify" as const;
  private publisher: Client;
  private subscriber: Client;
  private subscribers = new Map<string, Set<EventBusHandler>>();
  private channel: string;
  private closed = false;

  constructor(databaseUrl: string, channel: string) {
    this.channel = channel;
    this.publisher = new Client({ connectionString: databaseUrl });
    this.subscriber = new Client({ connectionString: databaseUrl });
  }

  public async init(): Promise<void> {
    await this.publisher.connect();
    await this.subscriber.connect();
    this.subscriber.on("notification", (notification) => {
      if (notification.channel !== this.channel || !notification.payload) {
        return;
      }

      const decoded = decodeMessage(notification.payload);
      if (!decoded) {
        return;
      }

      void this.dispatch(decoded);
    });
    await this.subscriber.query(`LISTEN ${this.channel}`);
  }

  public async publish<TPayload = unknown>(
    topic: string,
    payload: TPayload,
    options?: { source?: string; timestamp?: string }
  ): Promise<void> {
    if (this.closed) {
      throw new Error("event bus is closed");
    }

    const message: EventBusMessage<TPayload> = {
      topic,
      payload,
      timestamp: options?.timestamp ?? new Date().toISOString(),
      source: options?.source
    };

    const escapedPayload = encodeMessage(message);
    await this.publisher.query(`NOTIFY ${this.channel}, '${escapedPayload}'`);
    await this.dispatch(message);
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
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.subscribers.clear();

    try {
      await this.subscriber.query(`UNLISTEN ${this.channel}`);
    } catch {
      // ignore unlisten failure
    }

    await Promise.allSettled([
      this.publisher.end(),
      this.subscriber.end()
    ]);
  }

  private async dispatch(message: EventBusMessage): Promise<void> {
    const handlers = this.subscribers.get(message.topic);
    if (!handlers || handlers.size === 0) {
      return;
    }

    await Promise.allSettled(
      [...handlers].map(async (handler) => {
        await handler(message);
      })
    );
  }
}

export async function createPostgresNotifyEventBus(
  options: CreatePostgresNotifyEventBusOptions
): Promise<EventBus> {
  const channel = options.channel ?? DEFAULT_CHANNEL;
  assertSafeChannel(channel);
  const bus = new PostgresNotifyEventBus(options.databaseUrl, channel);
  await bus.init();
  return bus;
}
