import assert from "node:assert/strict";
import test from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PgBossProposalQueueStore } from "../mcp/core/resource/proposal/pg-boss-proposal-queue.js";

test("pg-boss proposal queue stores, lists, and approves proposals", async (t) => {
  let container: StartedPostgreSqlContainer | undefined;

  try {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg17")
      .withDatabase("sfai")
      .withUsername("sfai")
      .withPassword("sfai")
      .start();
  } catch (error) {
    t.skip(`Docker/Testcontainers unavailable: ${String(error)}`);
    return;
  }

  const store = await PgBossProposalQueueStore.open({
    databaseUrl: container.getConnectionUri()
  });
  const boss = (store as unknown as { boss: { getSchedules: (name?: string, key?: string) => Promise<Array<{ cron: string }>> } }).boss;

  try {
    const enqueued = await store.enqueue({
      resourceType: "skills",
      name: "Queued Skill",
      content: "# queued-skill\nbody",
      confidence: 0.8,
      origin: "test"
    });

    assert.equal(enqueued.status, "pending");

    const pending = await store.list({ status: "pending" });
    assert.ok(pending.some((item) => item.id === enqueued.id));

    const approved = await store.approve(enqueued.id);
    assert.equal(approved.status, "approved");

    const summary = await store.summarize();
    assert.equal(summary.pending, 0);
    assert.equal(summary.approved, 1);
    assert.equal(summary.byResourceType.skills.approved, 1);
  } finally {
    await store.close();
    await container.stop();
  }
});

test("pg-boss proposal queue can upsert and remove recurring schedules", async (t) => {
  let container: StartedPostgreSqlContainer | undefined;

  try {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg17")
      .withDatabase("sfai")
      .withUsername("sfai")
      .withPassword("sfai")
      .start();
  } catch (error) {
    t.skip(`Docker/Testcontainers unavailable: ${String(error)}`);
    return;
  }

  const store = await PgBossProposalQueueStore.open({
    databaseUrl: container.getConnectionUri()
  });
  const boss = (store as unknown as { boss: { getSchedules: (name?: string, key?: string) => Promise<Array<{ cron: string }>> } }).boss;

  try {
    await store.scheduleRecurringJob?.({
      queue: "governance-auto-cleanup",
      cron: "*/5 * * * *",
      key: "schedule-test-1",
      data: {
        scheduleId: "schedule-test-1",
        action: "dry-run"
      }
    });

    let schedules = await boss.getSchedules("governance-auto-cleanup", "schedule-test-1");
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0].cron, "*/5 * * * *");

    await store.scheduleRecurringJob?.({
      queue: "governance-auto-cleanup",
      cron: "*/10 * * * *",
      key: "schedule-test-1",
      data: {
        scheduleId: "schedule-test-1",
        action: "apply"
      }
    });

    schedules = await boss.getSchedules("governance-auto-cleanup", "schedule-test-1");
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0].cron, "*/10 * * * *");

    await store.unscheduleRecurringJob?.({
      queue: "governance-auto-cleanup",
      key: "schedule-test-1"
    });

    schedules = await boss.getSchedules("governance-auto-cleanup", "schedule-test-1");
    assert.equal(schedules.length, 0);
  } finally {
    await store.close();
    await container.stop();
  }
});