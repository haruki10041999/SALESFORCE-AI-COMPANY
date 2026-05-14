import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { GovTool, GovToolHandler } from "../mcp/tool-types.js";
import { defineObservabilityDashboardTool } from "../mcp/handlers/analytics/observability-dashboard.js";

function captureHandler<TInput>(register: (govTool: GovTool) => void): GovToolHandler<TInput> {
  let captured: GovToolHandler<TInput> | undefined;
  const govTool: GovTool = (_name, _config, handler) => {
    captured = handler as unknown as GovToolHandler<TInput>;
  };
  register(govTool);
  assert.ok(captured, "expected dashboard handler");
  return captured;
}

test("observability_dashboard includes learning promotion history in JSON output", async () => {
  const outputsDir = mkdtempSync(join(tmpdir(), "sf-ai-obsv-dashboard-"));
  const learningDir = join(outputsDir, "learning");
  const historyPath = join(learningDir, "promotion-history.jsonl");
  mkdirSync(learningDir, { recursive: true });
  writeFileSync(
    historyPath,
    JSON.stringify({
      modelName: "ranker",
      stage: "promoted",
      action: "promote",
      reason: "policy-satisfied",
      candidateVersion: "v2",
      currentProductionVersion: "v2",
      previousVersion: "v1",
      policySnapshotTag: "policy-snapshot:ranker@v2",
      dag: [],
      occurredAt: "2026-05-14T00:00:00.000Z"
    }) + "\n",
    "utf-8"
  );

  const handler = captureHandler<{
    format?: "json";
    eventLimit?: number;
    traceLimit?: number;
    promotionLimit?: number;
  }>((govTool) => {
    defineObservabilityDashboardTool({
      govTool,
      outputsDir,
      loadSystemEvents: async () => [
        {
          id: "e1",
          event: "tool_after_execute",
          timestamp: "2026-05-14T00:00:00.500Z",
          payload: {}
        }
      ],
      loadGovernanceState: async () => ({
        disabled: { skills: [], tools: ["deploy_org"], presets: [] },
        lifecycle: { skills: {}, tools: { legacy_tool: "deprecated" }, presets: {} }
      })
    });
  });

  const result = await handler({ format: "json", eventLimit: 100, traceLimit: 20, promotionLimit: 20 });
  const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
    summary?: { learningPromotionCount?: number; governanceFlaggedCount?: number };
    learningPromotions?: Array<{ modelName: string; stage: string }>;
  };

  assert.equal(payload.summary?.learningPromotionCount, 1);
  assert.ok((payload.summary?.governanceFlaggedCount ?? 0) >= 1);
  assert.equal(payload.learningPromotions?.[0]?.modelName, "ranker");
  assert.equal(payload.learningPromotions?.[0]?.stage, "promoted");
});
