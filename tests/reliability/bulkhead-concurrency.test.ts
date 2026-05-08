import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Bulkhead, BulkheadRejectedError } from "../../mcp/core/reliability/bulkhead.js";

describe("Bulkhead", () => {
  it("limits concurrency", async () => {
    const bulkhead = new Bulkhead("test", { concurrency: 2, maxQueue: 10 });

    let running = 0;
    let maxRunning = 0;

    const task = async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 30));
      running -= 1;
      return "ok";
    };

    const results = await Promise.all([
      bulkhead.execute(task),
      bulkhead.execute(task),
      bulkhead.execute(task),
      bulkhead.execute(task),
      bulkhead.execute(task)
    ]);

    assert.equal(results.length, 5);
    assert.ok(maxRunning <= 2, `maxRunning=${maxRunning} should be <= 2`);
  });

  it("rejects when queue is full", async () => {
    const bulkhead = new Bulkhead("test-queue", { concurrency: 1, maxQueue: 1 });

    const longTask = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "done";
    };

    // 1st: running
    const p1 = bulkhead.execute(longTask);
    // 2nd: queued
    const p2 = bulkhead.execute(longTask);
    // 3rd: should be rejected (queue full)
    await assert.rejects(
      () => bulkhead.execute(longTask),
      (err: unknown) => err instanceof BulkheadRejectedError
    );

    await Promise.all([p1, p2]);
  });

  it("exposes active and pending counts", async () => {
    const bulkhead = new Bulkhead("test-stats", { concurrency: 1, maxQueue: 2 });

    const blocker = new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });

    const p1 = bulkhead.execute(async () => {
      await blocker;
      return 1;
    });

    const p2 = bulkhead.execute(async () => 2);

    // small delay so p1 enters running and p2 enters queue
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(bulkhead.activeCount, 1);
    assert.ok(bulkhead.pendingCount >= 1);

    await Promise.all([p1, p2]);
    assert.equal(bulkhead.activeCount, 0);
  });
});
