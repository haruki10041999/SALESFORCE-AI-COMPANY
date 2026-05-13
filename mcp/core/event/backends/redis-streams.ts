import { Socket } from "node:net";
import {
  type EventBus,
  type EventBusHandler,
  type EventBusMessage
} from "../event-bus.js";
import { getActiveTraceContext, runWithTraceContext } from "../../trace/trace-context.js";

const DEFAULT_STREAM_KEY = "sfai_event_bus_stream";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CreateRedisStreamsEventBusOptions {
  redisUrl: string;
  streamKey?: string;
  connectionFactory?: () => Promise<RedisConnection>;
}

interface RedisConnection {
  sendCommand(args: string[]): Promise<RedisReply>;
  close(): Promise<void>;
}

type RedisReply = string | number | null | RedisReply[];

function encodeCommand(args: string[]): Buffer {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    const value = Buffer.from(arg, "utf-8");
    parts.push(`$${value.length}\r\n`);
    parts.push(arg);
    parts.push("\r\n");
  }
  return Buffer.from(parts.join(""), "utf-8");
}

function parseRedisUrl(redisUrl: string): { host: string; port: number; password?: string; database?: number } {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname || "127.0.0.1",
    port: Number.parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
    database: parsed.pathname && parsed.pathname.length > 1 ? Number.parseInt(parsed.pathname.slice(1), 10) : undefined
  };
}

function readLine(buffer: Buffer, start: number): { line: string; next: number } | null {
  const end = buffer.indexOf("\r\n", start);
  if (end < 0) {
    return null;
  }
  return { line: buffer.toString("utf-8", start, end), next: end + 2 };
}

function parseReply(buffer: Buffer, start = 0): { value: RedisReply; next: number } | null {
  if (start >= buffer.length) {
    return null;
  }

  const type = String.fromCharCode(buffer[start] ?? 0);
  if (type === "+" || type === "-") {
    const line = readLine(buffer, start + 1);
    if (!line) {
      return null;
    }
    if (type === "-") {
      throw new Error(line.line);
    }
    return { value: line.line, next: line.next };
  }

  if (type === ":") {
    const line = readLine(buffer, start + 1);
    if (!line) {
      return null;
    }
    return { value: Number.parseInt(line.line, 10), next: line.next };
  }

  if (type === "$") {
    const line = readLine(buffer, start + 1);
    if (!line) {
      return null;
    }
    const length = Number.parseInt(line.line, 10);
    if (length < 0) {
      return { value: null, next: line.next };
    }
    const end = line.next + length;
    if (buffer.length < end + 2) {
      return null;
    }
    return { value: buffer.toString("utf-8", line.next, end), next: end + 2 };
  }

  if (type === "*") {
    const line = readLine(buffer, start + 1);
    if (!line) {
      return null;
    }
    const count = Number.parseInt(line.line, 10);
    if (count < 0) {
      return { value: null, next: line.next };
    }
    let cursor = line.next;
    const values: RedisReply[] = [];
    for (let index = 0; index < count; index += 1) {
      const item = parseReply(buffer, cursor);
      if (!item) {
        return null;
      }
      values.push(item.value);
      cursor = item.next;
    }
    return { value: values, next: cursor };
  }

  throw new Error(`Unsupported RESP type: ${type}`);
}

class RedisConnectionImpl implements RedisConnection {
  private readonly socket: Socket;
  private buffer = Buffer.alloc(0);
  private pending: Array<{ resolve: (value: RedisReply) => void; reject: (error: Error) => void }> = [];
  private closed = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly password?: string,
    private readonly database?: number
  ) {
    this.socket = new Socket();
  }

  public async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.once("error", reject);
      this.socket.connect(this.port, this.host, async () => {
        try {
          this.socket.off("error", reject);
          this.socket.on("data", (chunk) => this.onData(chunk));
          this.socket.on("error", (error) => this.failAll(error instanceof Error ? error : new Error(String(error))));
          this.socket.on("close", () => this.failAll(new Error("redis connection closed")));
          if (this.password) {
            await this.sendCommand(["AUTH", this.password]);
          }
          if (typeof this.database === "number" && Number.isFinite(this.database)) {
            await this.sendCommand(["SELECT", String(this.database)]);
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  public async sendCommand(args: string[]): Promise<RedisReply> {
    if (this.closed) {
      throw new Error("redis connection is closed");
    }

    const payload = encodeCommand(args);
    return new Promise<RedisReply>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(payload, (error) => {
        if (error) {
          const pending = this.pending.pop();
          pending?.reject(error);
        }
      });
    });
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.socket.end();
    } catch {
      // ignore close failures
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.pending.length > 0) {
      const parsed = parseReply(this.buffer);
      if (!parsed) {
        return;
      }
      const pending = this.pending.shift();
      pending?.resolve(parsed.value);
      this.buffer = this.buffer.subarray(parsed.next);
    }
  }

  private failAll(error: Error): void {
    while (this.pending.length > 0) {
      this.pending.shift()?.reject(error);
    }
  }
}

class RedisStreamsEventBus implements EventBus {
  public readonly backend = "redis-streams" as const;
  private readonly streamKey: string;
  private readonly connectionFactory: () => Promise<RedisConnection>;
  private publisher: RedisConnection | null = null;
  private subscriber: RedisConnection | null = null;
  private subscriberLoop: Promise<void> | null = null;
  private subscribers = new Map<string, Set<EventBusHandler>>();
  private closed = false;

  constructor(streamKey: string, connectionFactory: () => Promise<RedisConnection>) {
    this.streamKey = streamKey;
    this.connectionFactory = connectionFactory;
  }

  public async publish<TPayload = unknown>(
    topic: string,
    payload: TPayload,
    options?: { source?: string; timestamp?: string; traceId?: string; traceparent?: string }
  ): Promise<void> {
    if (this.closed) {
      throw new Error("event bus is closed");
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

    const publisher = await this.getPublisher();
    await publisher.sendCommand([
      "XADD",
      this.streamKey,
      "*",
      "topic",
      topic,
      "payload",
      JSON.stringify(message.payload),
      "timestamp",
      message.timestamp,
      "source",
      message.source ?? "",
      "traceId",
      message.traceId ?? "",
      "traceparent",
      message.traceparent ?? ""
    ]);
  }

  public async subscribe<TPayload = unknown>(
    topic: string,
    handler: EventBusHandler<TPayload>
  ): Promise<() => void> {
    const handlers = this.subscribers.get(topic) ?? new Set<EventBusHandler>();
    handlers.add(handler as EventBusHandler);
    this.subscribers.set(topic, handlers);

    await this.ensureSubscriberLoop();

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
    await Promise.allSettled([
      this.publisher?.close() ?? Promise.resolve(),
      this.subscriber?.close() ?? Promise.resolve(),
      this.subscriberLoop ?? Promise.resolve()
    ]);
  }

  private async getPublisher(): Promise<RedisConnection> {
    if (!this.publisher) {
      this.publisher = await this.connectionFactory();
    }
    return this.publisher;
  }

  private async getSubscriber(): Promise<RedisConnection> {
    if (!this.subscriber) {
      this.subscriber = await this.connectionFactory();
    }
    return this.subscriber;
  }

  private async ensureSubscriberLoop(): Promise<void> {
    if (this.subscriberLoop) {
      return;
    }
    this.subscriberLoop = this.runSubscriberLoop().catch(() => undefined);
    await Promise.resolve();
  }

  private async runSubscriberLoop(): Promise<void> {
    const subscriber = await this.getSubscriber();
    let lastId = "$";

    while (!this.closed) {
      const reply = await subscriber.sendCommand([
        "XREAD",
        "BLOCK",
        "1000",
        "COUNT",
        "100",
        "STREAMS",
        this.streamKey,
        lastId
      ]);

      if (!Array.isArray(reply) || reply.length === 0) {
        await sleep(10);
        continue;
      }

      for (const streamEntry of reply) {
        if (!Array.isArray(streamEntry) || streamEntry.length < 2) {
          continue;
        }
        const entries = streamEntry[1];
        if (!Array.isArray(entries)) {
          continue;
        }
        for (const entry of entries) {
          if (!Array.isArray(entry) || entry.length < 2) {
            continue;
          }
          const id = typeof entry[0] === "string" ? entry[0] : lastId;
          lastId = id;
          const fields = entry[1];
          if (!Array.isArray(fields)) {
            continue;
          }
          const record = this.decodeFields(fields);
          if (record) {
            await this.dispatch(record);
          }
        }
      }
    }
  }

  private decodeFields(fields: RedisReply[]): EventBusMessage | null {
    const record: Record<string, string> = {};
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const key = fields[index];
      const value = fields[index + 1];
      if (typeof key !== "string") {
        continue;
      }
      record[key] = typeof value === "string" ? value : String(value ?? "");
    }

    if (typeof record.topic !== "string" || typeof record.timestamp !== "string") {
      return null;
    }

    return {
      topic: record.topic,
      payload: record.payload ? JSON.parse(record.payload) : undefined,
      timestamp: record.timestamp,
      source: record.source || undefined,
      traceId: record.traceId || undefined,
      traceparent: record.traceparent || undefined
    };
  }

  private async dispatch(message: EventBusMessage): Promise<void> {
    const handlers = this.subscribers.get(message.topic);
    if (!handlers || handlers.size === 0) {
      return;
    }

    await Promise.allSettled(
      [...handlers].map(async (handler) => {
        if (message.traceId && message.traceparent) {
          await Promise.resolve(runWithTraceContext({ traceId: message.traceId, traceparent: message.traceparent }, () => handler(message)));
          return;
        }
        await handler(message);
      })
    );
  }
}

function createRedisConnectionFactory(redisUrl: string): () => Promise<RedisConnection> {
  const { host, port, password, database } = parseRedisUrl(redisUrl);
  return async () => {
    const connection = new RedisConnectionImpl(host, port, password, database);
    await connection.connect();
    return connection;
  };
}

export async function createRedisStreamsEventBus(
  options: CreateRedisStreamsEventBusOptions
): Promise<EventBus> {
  const streamKey = options.streamKey ?? DEFAULT_STREAM_KEY;
  const connectionFactory = options.connectionFactory ?? createRedisConnectionFactory(options.redisUrl);
  return new RedisStreamsEventBus(streamKey, connectionFactory);
}
