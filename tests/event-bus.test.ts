import test from "node:test";
import assert from "node:assert/strict";

import { createEventBus } from "../mcp/core/event/event-bus.js";
import { EventDispatcher, type SystemEvent } from "../mcp/core/event/event-dispatcher.js";
import {
  buildTraceparentFromTraceId,
  getActiveTraceContext,
  runWithTraceContext
} from "../mcp/core/trace/trace-context.js";

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

test("event bus propagates trace context across publish/subscribe", async () => {
  const bus = await createEventBus({ backend: "in-memory" });
  const traceId = "11111111-2222-3333-4444-555555555555";
  const traceparent = buildTraceparentFromTraceId(traceId);
  const seen: Array<{ traceId?: string; traceparent?: string; active?: string }> = [];

  const unsubscribe = await bus.subscribe("trace.topic", async (message) => {
    const active = getActiveTraceContext();
    seen.push({
      traceId: message.traceId,
      traceparent: message.traceparent,
      active: active?.traceId
    });
  });

  await Promise.resolve(
    runWithTraceContext({ traceId, traceparent }, async () => {
      await bus.publish("trace.topic", { ok: true });
    })
  );

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.traceId, traceId);
  assert.equal(seen[0]?.traceparent, traceparent);
  assert.equal(seen[0]?.active, traceId);

  await unsubscribe();
  await bus.close();
});
