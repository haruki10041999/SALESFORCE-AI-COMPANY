import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker, CircuitBreakerOpenError } from "../../mcp/core/reliability/circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("opens when failure rate crosses threshold", async () => {
    const cb = new CircuitBreaker({
      name: "test-open",
      failureRateThreshold: 0.5,
      minCallsInWindow: 4,
      windowSize: 4,
      cooldownMs: 100
    });

    const fail = async () => { throw new Error("fail"); };
    const ok = async () => "ok";

    await assert.rejects(() => cb.execute(fail)); // fail
    await assert.rejects(() => cb.execute(fail)); // fail
    await cb.execute(ok); // success
    await assert.rejects(() => cb.execute(fail)); // fail (3/4 fail => 0.75)

    // 失敗時にウィンドウ評価され、threshold 以上で open になる
    assert.equal(cb.currentState, "open");

    await assert.rejects(
      () => cb.execute(ok),
      (err: unknown) => err instanceof CircuitBreakerOpenError
    );
  });

  it("transitions open -> half-open -> closed on successful probe", async () => {
    const cb = new CircuitBreaker({
      name: "test-half-open",
      failureRateThreshold: 0.5,
      minCallsInWindow: 2,
      windowSize: 2,
      cooldownMs: 20,
      halfOpenSuccessThreshold: 1
    });

    const fail = async () => { throw new Error("fail"); };

    await assert.rejects(() => cb.execute(fail));
    await assert.rejects(() => cb.execute(fail)); // now open
    assert.equal(cb.currentState, "open");

    // wait cooldown
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(cb.currentState, "half-open");

    const result = await cb.execute(async () => "recovered");
    assert.equal(result, "recovered");
    assert.equal(cb.currentState, "closed");
  });

  it("half-open failure returns to open", async () => {
    const cb = new CircuitBreaker({
      name: "test-half-open-fail",
      failureRateThreshold: 0.5,
      minCallsInWindow: 2,
      windowSize: 2,
      cooldownMs: 20,
      halfOpenSuccessThreshold: 1
    });

    const fail = async () => { throw new Error("fail"); };

    await assert.rejects(() => cb.execute(fail));
    await assert.rejects(() => cb.execute(fail));
    assert.equal(cb.currentState, "open");

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(cb.currentState, "half-open");

    await assert.rejects(() => cb.execute(fail));
    assert.equal(cb.currentState, "open");
  });

  it("reset forces closed state", async () => {
    const cb = new CircuitBreaker({
      name: "test-reset",
      failureRateThreshold: 0.5,
      minCallsInWindow: 2,
      windowSize: 2,
      cooldownMs: 100
    });

    await assert.rejects(() => cb.execute(async () => { throw new Error("x"); }));
    await assert.rejects(() => cb.execute(async () => { throw new Error("x"); }));
    assert.equal(cb.currentState, "open");

    cb.reset();
    assert.equal(cb.currentState, "closed");

    const out = await cb.execute(async () => "ok");
    assert.equal(out, "ok");
  });
});
