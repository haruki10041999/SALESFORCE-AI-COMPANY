import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const feedbackManagerModulePath = resolve(here, "../mcp/core/learning/feedback-manager.ts");

async function importFeedbackManagerFresh() {
  return await import(`${pathToFileURL(feedbackManagerModulePath).href}?t=${Date.now()}-${Math.random()}`);
}

test("feedback-manager returns empty collections and zero metrics when no feedback exists", { concurrency: false }, async () => {
  const originalCwd = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "sf-ai-feedback-empty-"));

  try {
    process.chdir(root);
    const feedbackManager = await importFeedbackManagerFresh();

    const allFeedback = await feedbackManager.loadAllFeedback();
    const sessionFeedback = await feedbackManager.loadFeedbackForSession("missing-session");
    const metrics = await feedbackManager.computeFeedbackMetrics();

    assert.deepEqual(allFeedback, []);
    assert.deepEqual(sessionFeedback, []);
    assert.equal(metrics.totalFeedback, 0);
    assert.equal(metrics.thumbsUpCount, 0);
    assert.equal(metrics.thumbsDownCount, 0);
    assert.equal(metrics.neutralCount, 0);
    assert.equal(metrics.thumbsUpRate, 0);
    assert.equal(metrics.averageQualityScore, undefined);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("feedback-manager records feedback, loads by session, and aggregates metrics", { concurrency: false }, async () => {
  const originalCwd = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "sf-ai-feedback-roundtrip-"));

  try {
    process.chdir(root);
    const feedbackManager = await importFeedbackManagerFresh();

    const first = await feedbackManager.recordUserFeedback({
      sessionId: "session-a",
      rating: "thumbs-up",
      agentName: "architect",
      comment: "helpful",
      qualityScore: 0.9,
      tags: ["design", "apex"]
    });
    const second = await feedbackManager.recordUserFeedback({
      sessionId: "session-a",
      rating: "thumbs-down",
      qualityScore: 0.3,
      tags: ["apex"]
    });
    await feedbackManager.recordUserFeedback({
      sessionId: "session-b",
      rating: "neutral",
      qualityScore: 0.6,
      tags: ["lwc"]
    });

    assert.match(first.feedbackId, /^[0-9a-f-]{36}$/i);
    assert.match(second.feedbackId, /^[0-9a-f-]{36}$/i);

    const persisted = await readFile(join(root, "outputs", "learning", "feedback.jsonl"), "utf-8");
    const persistedLines = persisted.trim().split("\n");
    assert.equal(persistedLines.length, 3);

    const sessionAFeedback = await feedbackManager.loadFeedbackForSession("session-a");
    const allMetrics = await feedbackManager.computeFeedbackMetrics();
    const sessionAMetrics = await feedbackManager.computeFeedbackMetrics("session-a");

    assert.equal(sessionAFeedback.length, 2);
    assert.equal(allMetrics.totalFeedback, 3);
    assert.equal(allMetrics.thumbsUpCount, 1);
    assert.equal(allMetrics.thumbsDownCount, 1);
    assert.equal(allMetrics.neutralCount, 1);
    assert.equal(allMetrics.thumbsUpRate, 1 / 3);
    assert.equal(allMetrics.averageQualityScore, 0.6);
    assert.deepEqual(allMetrics.mostCommonTags, [
      { tag: "apex", count: 2 },
      { tag: "design", count: 1 },
      { tag: "lwc", count: 1 }
    ]);

    assert.equal(sessionAMetrics.totalFeedback, 2);
    assert.equal(sessionAMetrics.thumbsUpCount, 1);
    assert.equal(sessionAMetrics.thumbsDownCount, 1);
    assert.equal(sessionAMetrics.neutralCount, 0);
    assert.equal(sessionAMetrics.thumbsUpRate, 0.5);
    assert.equal(sessionAMetrics.averageQualityScore, 0.6);
    assert.deepEqual(sessionAMetrics.mostCommonTags, [
      { tag: "apex", count: 2 },
      { tag: "design", count: 1 }
    ]);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});