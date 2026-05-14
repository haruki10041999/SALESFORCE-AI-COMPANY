import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventDispatcher } from "../mcp/core/event/event-dispatcher.js";

describe("EventDispatcher schema normalization", () => {
  it("adds schemaVersion to system event payload", async () => {
    const dispatcher = new EventDispatcher();
    await dispatcher.emit({
      type: "resource_created",
      timestamp: new Date().toISOString(),
      payload: { resourceType: "skills", name: "x" }
    });

    const history = dispatcher.getHistory("resource_created", 1);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.payload?.schemaVersion, 1);
  });
});
