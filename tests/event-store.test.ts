import test from "node:test";
import assert from "node:assert/strict";
import {
  type AppendEventInput,
  type EventHandler,
  type StoredEvent,
  OptimisticConcurrencyError
} from "../mcp/core/ports/event-store.js";

// ---- In-memory stub for unit tests (no DB) --------------------------------

class InMemoryEventStore {
  private readonly rows: StoredEvent[] = [];
  private nextId = 1;
  private nextSeq = 1;
  private readonly subscribers: Array<{
    handler: EventHandler;
    eventTypes?: string[];
  }> = [];

  async append(input: AppendEventInput): Promise<StoredEvent> {
    const maxVersion = this.rows
      .filter((r) => r.streamId === input.streamId && r.status === "active")
      .reduce((m, r) => Math.max(m, r.version), -1);

    if (maxVersion !== input.expectedVersion - 1) {
      throw new OptimisticConcurrencyError(
        input.streamId,
        input.expectedVersion,
        maxVersion + 1
      );
    }

    const stored: StoredEvent = {
      id: this.nextId++,
      globalSeq: this.nextSeq++,
      streamId: input.streamId,
      eventType: input.eventType,
      version: input.expectedVersion,
      tenantId: input.tenantId ?? null,
      actorId: input.actorId,
      payload: input.payload,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      status: "active"
    };
    this.rows.push(stored);

    for (const { handler, eventTypes } of this.subscribers) {
      if (!eventTypes || eventTypes.includes(stored.eventType)) {
        void Promise.resolve(handler(stored)).catch(() => {});
      }
    }
    return stored;
  }

  async read(streamId: string): Promise<StoredEvent[]> {
    return this.rows
      .filter((r) => r.streamId === streamId && r.status === "active")
      .sort((a, b) => a.version - b.version);
  }

  subscribe(handler: EventHandler, options: { eventTypes?: string[] } = {}): () => void {
    const entry = { handler, eventTypes: options.eventTypes };
    this.subscribers.push(entry);
    return () => {
      const idx = this.subscribers.indexOf(entry);
      if (idx !== -1) this.subscribers.splice(idx, 1);
    };
  }

  async tombstone(id: number): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.status = "tombstoned";
      row.payload = {};
    }
  }
}

// ---- Tests -----------------------------------------------------------------

test("EventStore: append increments version and returns StoredEvent", async () => {
  const store = new InMemoryEventStore();

  const ev = await store.append({
    streamId: "proposal:aaa",
    eventType: "proposal.created",
    expectedVersion: 0,
    payload: { title: "test" }
  });

  assert.equal(ev.version, 0);
  assert.equal(ev.eventType, "proposal.created");
  assert.equal(ev.streamId, "proposal:aaa");
  assert.ok(ev.id > 0);
  assert.ok(ev.globalSeq > 0);
});

test("EventStore: append multiple events increments version", async () => {
  const store = new InMemoryEventStore();

  await store.append({
    streamId: "session:bbb",
    eventType: "session.started",
    expectedVersion: 0,
    payload: {}
  });

  const ev2 = await store.append({
    streamId: "session:bbb",
    eventType: "session.step_added",
    expectedVersion: 1,
    payload: { step: "chat" }
  });

  assert.equal(ev2.version, 1);
});

test("EventStore: read returns events ordered by version", async () => {
  const store = new InMemoryEventStore();
  const streamId = "proposal:ccc";

  for (let v = 0; v < 5; v++) {
    await store.append({
      streamId,
      eventType: `event.${v}`,
      expectedVersion: v,
      payload: { v }
    });
  }

  const events = await store.read(streamId);
  assert.equal(events.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.equal(events[i]!.version, i);
  }
});

test("EventStore: optimistic concurrency error on wrong expectedVersion", async () => {
  const store = new InMemoryEventStore();

  await store.append({
    streamId: "proposal:ddd",
    eventType: "proposal.created",
    expectedVersion: 0,
    payload: {}
  });

  await assert.rejects(
    () =>
      store.append({
        streamId: "proposal:ddd",
        eventType: "proposal.approved",
        expectedVersion: 0, // wrong — should be 1
        payload: {}
      }),
    (err: unknown) => {
      assert.ok(err instanceof OptimisticConcurrencyError);
      assert.equal(err.streamId, "proposal:ddd");
      assert.equal(err.expectedVersion, 0);
      return true;
    }
  );
});

test("EventStore: independent streams do not interfere with versioning", async () => {
  const store = new InMemoryEventStore();

  await store.append({ streamId: "s1", eventType: "e", expectedVersion: 0, payload: {} });
  await store.append({ streamId: "s2", eventType: "e", expectedVersion: 0, payload: {} });
  await store.append({ streamId: "s1", eventType: "e", expectedVersion: 1, payload: {} });

  const s1 = await store.read("s1");
  const s2 = await store.read("s2");
  assert.equal(s1.length, 2);
  assert.equal(s2.length, 1);
});

test("EventStore: subscribe receives new events", async () => {
  const store = new InMemoryEventStore();
  const received: StoredEvent[] = [];

  store.subscribe((ev): void => {
    received.push(ev);
  });

  await store.append({ streamId: "sub:eee", eventType: "x", expectedVersion: 0, payload: {} });
  await new Promise<void>((r) => { setTimeout(r, 10); });

  assert.equal(received.length, 1);
  assert.equal(received[0]!.eventType, "x");
});

test("EventStore: subscribe with eventType filter receives only matching events", async () => {
  const store = new InMemoryEventStore();
  const received: StoredEvent[] = [];

  store.subscribe((ev): void => { received.push(ev); }, { eventTypes: ["target.event"] });

  await store.append({ streamId: "filter:fff", eventType: "other.event", expectedVersion: 0, payload: {} });
  await store.append({ streamId: "filter:fff", eventType: "target.event", expectedVersion: 1, payload: {} });
  await new Promise<void>((r) => { setTimeout(r, 10); });

  assert.equal(received.length, 1);
  assert.equal(received[0]!.eventType, "target.event");
});

test("EventStore: unsubscribe stops receiving events", async () => {
  const store = new InMemoryEventStore();
  const received: StoredEvent[] = [];

  const unsub = store.subscribe((ev): void => { received.push(ev); });
  await store.append({ streamId: "unsub:ggg", eventType: "e", expectedVersion: 0, payload: {} });
  await new Promise<void>((r) => { setTimeout(r, 10); });
  assert.equal(received.length, 1);

  unsub();
  await store.append({ streamId: "unsub:ggg", eventType: "e", expectedVersion: 1, payload: {} });
  await new Promise<void>((r) => { setTimeout(r, 10); });
  assert.equal(received.length, 1); // no new events after unsubscribe
});

test("EventStore: tombstone removes event from read results", async () => {
  const store = new InMemoryEventStore();

  const ev = await store.append({ streamId: "tomb:hhh", eventType: "e", expectedVersion: 0, payload: { secret: "pii" } });
  await store.tombstone(ev.id);

  const events = await store.read("tomb:hhh");
  assert.equal(events.length, 0);
});

test("OptimisticConcurrencyError has correct properties", () => {
  const err = new OptimisticConcurrencyError("stream:xyz", 3, 5);
  assert.equal(err.streamId, "stream:xyz");
  assert.equal(err.expectedVersion, 3);
  assert.equal(err.actualVersion, 5);
  assert.ok(err.message.includes("stream:xyz"));
  assert.ok(err instanceof OptimisticConcurrencyError);
  assert.ok(err instanceof Error);
});
