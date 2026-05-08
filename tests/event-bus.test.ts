import test from "node:test";
import assert from "node:assert/strict";

import { createEventBus } from "../mcp/core/event/event-bus.js";
import { EventDispatcher, type SystemEvent } from "../mcp/core/event/event-dispatcher.js";

test("in-memory event bus publish/subscribe", async () => {
  const bus = await createEventBus({ backend: "in-memory" });
  const received: Array<{ topic: string; value: string }> = [];

  const unsubscribe = await bus.subscribe<{ value: string }>("topic.test", async (message) => {
    const payload = message.payload as { value: string };
    received.push({ topic: message.topic, value: payload.value });
  });

  await bus.publish("topic.test", { value: "hello" });

  assert.equal(received.length, 1);
  assert.equal(received[0]?.topic, "topic.test");
  assert.equal(received[0]?.value, "hello");

  await unsubscribe();
  await bus.close();
});

test("event dispatcher can propagate via shared event bus", async () => {
  const bus = await createEventBus({ backend: "in-memory" });

  const dispatcherA = new EventDispatcher({ instanceId: "A" });
  const dispatcherB = new EventDispatcher({ instanceId: "B" });
  await dispatcherA.attachEventBus(bus);
  await dispatcherB.attachEventBus(bus);

  const received: SystemEvent[] = [];
  dispatcherB.on("resource_created", async (event) => {
    received.push(event);
  });

  const event: SystemEvent = {
    type: "resource_created",
    timestamp: new Date().toISOString(),
    payload: { name: "sample" }
  };

  await dispatcherA.emit(event);

  assert.equal(received.length, 1);
  assert.equal(received[0]?.type, "resource_created");
  assert.equal(received[0]?.payload.name, "sample");

  await bus.close();
});
