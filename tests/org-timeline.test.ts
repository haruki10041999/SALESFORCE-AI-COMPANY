import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  recordOrgTimelineEvent,
  getOrgTimelineEvents
} from "../mcp/core/org/org-timeline-store.js";

test("org timeline records and retrieves recent events", async () => {
  const root = mkdtempSync(join(tmpdir(), "org-timeline-test-"));
  try {
    const timelineDir = join(root, "org-timeline");

    await recordOrgTimelineEvent(timelineDir, "devhub", {
      type: "metadata-sync",
      summary: "Synced custom object metadata"
    });
    await recordOrgTimelineEvent(timelineDir, "devhub", {
      type: "deploy",
      summary: "Deployed flow updates"
    });

    const events = await getOrgTimelineEvents(timelineDir, "devhub", 10);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "deploy");
    assert.equal(events[1].type, "metadata-sync");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("org timeline limit returns newest N events", async () => {
  const root = mkdtempSync(join(tmpdir(), "org-timeline-limit-"));
  try {
    const timelineDir = join(root, "org-timeline");

    await recordOrgTimelineEvent(timelineDir, "sandbox1", {
      type: "event-1",
      summary: "first"
    });
    await recordOrgTimelineEvent(timelineDir, "sandbox1", {
      type: "event-2",
      summary: "second"
    });
    await recordOrgTimelineEvent(timelineDir, "sandbox1", {
      type: "event-3",
      summary: "third"
    });

    const events = await getOrgTimelineEvents(timelineDir, "sandbox1", 2);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "event-3");
    assert.equal(events[1].type, "event-2");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
