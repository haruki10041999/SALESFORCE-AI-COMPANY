import assert from "node:assert/strict";
import test from "node:test";
import { startHealthServer } from "../mcp/core/observability/health-server.js";

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

test("health server exposes /healthz /readyz /startupz", async () => {
  let ready = false;
  let started = false;

  const handle = await startHealthServer({
    port: 39091,
    logger: logger as any,
    isReady: () => ready,
    isStartupComplete: () => started
  });

  try {
    const health = await fetch("http://127.0.0.1:39091/healthz");
    assert.equal(health.status, 200);

    const readyBefore = await fetch("http://127.0.0.1:39091/readyz");
    assert.equal(readyBefore.status, 503);

    const startupBefore = await fetch("http://127.0.0.1:39091/startupz");
    assert.equal(startupBefore.status, 503);

    ready = true;
    started = true;

    const readyAfter = await fetch("http://127.0.0.1:39091/readyz");
    assert.equal(readyAfter.status, 200);

    const startupAfter = await fetch("http://127.0.0.1:39091/startupz");
    assert.equal(startupAfter.status, 200);
  } finally {
    await handle.close();
  }
});
