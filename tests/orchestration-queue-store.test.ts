import assert from "node:assert/strict";
import test from "node:test";
import { createOrchestrationQueueStore } from "../mcp/core/orchestration/orchestration-queue-store.js";
import { runWithTenantContext } from "../mcp/core/identity/tenant-context.js";

test("in-memory orchestration queue store replaces and dequeues in order", async () => {
  const store = await createOrchestrationQueueStore({ stateBackend: "sqlite" });
  try {
    await store.replace("sess-1", ["agent-a", "agent-b", "agent-c"]);
    const first = await store.dequeue("sess-1", 2);
    const second = await store.dequeue("sess-1", 2);

    assert.deepEqual(first, ["agent-a", "agent-b"]);
    assert.deepEqual(second, ["agent-c"]);
  } finally {
    await store.close();
  }
});

test("in-memory orchestration queue store enqueue appends after replace", async () => {
  const store = await createOrchestrationQueueStore({ stateBackend: "sqlite" });
  try {
    await store.replace("sess-2", ["agent-a"]);
    await store.enqueue("sess-2", ["agent-b", "agent-c"]);
    const next = await store.dequeue("sess-2", 5);

    assert.deepEqual(next, ["agent-a", "agent-b", "agent-c"]);
  } finally {
    await store.close();
  }
});

test("in-memory orchestration queue store isolates by tenant for same session id", async () => {
  const store = await createOrchestrationQueueStore({ stateBackend: "sqlite" });
  try {
    await runWithTenantContext("tenant-a", async () => {
      await store.replace("sess-shared", ["agent-a"]);
    });
    await runWithTenantContext("tenant-b", async () => {
      await store.replace("sess-shared", ["agent-b"]);
    });

    const a = await runWithTenantContext("tenant-a", async () => store.dequeue("sess-shared", 5));
    const b = await runWithTenantContext("tenant-b", async () => store.dequeue("sess-shared", 5));

    assert.deepEqual(a, ["agent-a"]);
    assert.deepEqual(b, ["agent-b"]);
  } finally {
    await store.close();
  }
});
