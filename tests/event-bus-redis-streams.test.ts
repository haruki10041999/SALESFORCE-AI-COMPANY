import assert from "node:assert/strict";
import test from "node:test";
import { createRedisStreamsEventBus } from "../mcp/core/event/backends/redis-streams.js";

class FakeRedisConnection {
  public readonly commands: string[][] = [];
  private readonly replies: Array<any>;
  private closed = false;

  constructor(replies: Array<any> = []) {
    this.replies = [...replies];
  }

  async sendCommand(args: string[]): Promise<any> {
    if (this.closed) {
      throw new Error("closed");
    }
    this.commands.push(args);
    return this.replies.length > 0 ? this.replies.shift() : null;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

test("redis streams event bus publishes entries to the stream", async () => {
  const publisher = new FakeRedisConnection();
  const connections = [publisher];
  const bus = await createRedisStreamsEventBus({
    redisUrl: "redis://localhost:6379/0",
    streamKey: "sfai_event_bus_stream",
    connectionFactory: async () => {
      const connection = connections.shift();
      if (!connection) {
        throw new Error("unexpected connection request");
      }
      return connection as unknown as { sendCommand: (args: string[]) => Promise<any>; close: () => Promise<void> };
    }
  });

  await bus.publish("system_event", { id: "abc" }, { source: "tester" });
  assert.equal(bus.backend, "redis-streams");
  assert.equal(publisher.commands[0]?.[0], "XADD");
  assert.equal(publisher.commands[0]?.[1], "sfai_event_bus_stream");
  assert.equal(publisher.commands[0]?.[3], "topic");
  assert.equal(publisher.commands[0]?.[4], "system_event");

  await bus.close();
});
