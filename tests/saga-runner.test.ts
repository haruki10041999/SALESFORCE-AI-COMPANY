import test from "node:test";
import assert from "node:assert/strict";
import { defineSaga } from "../mcp/core/ports/saga.js";
import { runSaga } from "../mcp/infrastructure/workflow/saga-runner.js";

test("runSaga completes all steps when no failure occurs", async () => {
  const events: string[] = [];
  const context = { value: 0 };

  const saga = defineSaga<typeof context>({
    name: "happy-path",
    steps: [
      {
        name: "step-1",
        do: (ctx) => {
          ctx.value += 1;
        }
      },
      {
        name: "step-2",
        do: (ctx) => {
          ctx.value += 2;
        }
      }
    ]
  });

  const result = await runSaga({
    saga,
    context,
    onEvent: (event) => events.push(`${event.phase}:${event.step}`)
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.completedSteps, ["step-1", "step-2"]);
  assert.deepEqual(result.compensatedSteps, []);
  assert.equal(context.value, 3);
  assert.deepEqual(events, [
    "do:start:step-1",
    "do:done:step-1",
    "do:start:step-2",
    "do:done:step-2"
  ]);
});

test("runSaga compensates completed steps in reverse order on failure", async () => {
  const events: string[] = [];
  const context = { log: [] as string[] };

  const saga = defineSaga<typeof context>({
    name: "with-failure",
    steps: [
      {
        name: "reserve",
        do: (ctx) => {
          ctx.log.push("reserve");
        },
        undo: (ctx) => {
          ctx.log.push("undo-reserve");
        }
      },
      {
        name: "charge",
        do: () => {
          throw new Error("charge failed");
        },
        undo: () => {
          throw new Error("not-called");
        }
      }
    ]
  });

  const result = await runSaga({
    saga,
    context,
    onEvent: (event) => events.push(`${event.phase}:${event.step}`)
  });

  assert.equal(result.status, "compensated");
  assert.deepEqual(result.completedSteps, ["reserve"]);
  assert.deepEqual(result.compensatedSteps, ["reserve"]);
  assert.equal(result.failure?.step, "charge");
  assert.equal((result.failure?.error as Error).message, "charge failed");
  assert.deepEqual(result.compensationFailures, []);
  assert.deepEqual(context.log, ["reserve", "undo-reserve"]);
  assert.deepEqual(events, [
    "do:start:reserve",
    "do:done:reserve",
    "do:start:charge",
    "do:failed:charge",
    "undo:start:reserve",
    "undo:done:reserve"
  ]);
});

test("runSaga reports compensation failure but continues compensation flow", async () => {
  const context = { order: [] as string[] };

  const saga = defineSaga<typeof context>({
    name: "compensation-failure",
    steps: [
      {
        name: "step-a",
        do: (ctx) => {
          ctx.order.push("step-a");
        },
        undo: () => {
          throw new Error("undo-a failed");
        }
      },
      {
        name: "step-b",
        do: () => {
          throw new Error("step-b failed");
        }
      }
    ]
  });

  const result = await runSaga({ saga, context });

  assert.equal(result.status, "compensated");
  assert.equal(result.failure?.step, "step-b");
  assert.equal(result.compensationFailures.length, 1);
  assert.equal(result.compensationFailures[0]?.step, "step-a");
  assert.equal((result.compensationFailures[0]?.error as Error).message, "undo-a failed");
});
