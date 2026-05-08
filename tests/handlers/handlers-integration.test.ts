import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const handlersTestOutputsDir = mkdtempSync(join(tmpdir(), "sf-ai-handlers-outputs-"));
process.env.SF_AI_OUTPUTS_DIR = handlersTestOutputsDir;
process.env.SF_AI_STATE_BACKEND = "sqlite";
process.env.SF_AI_PROPOSAL_QUEUE_BACKEND = "file";
process.env.DATABASE_URL = "";
process.env.SF_AI_STATE_DB_PATH = join(handlersTestOutputsDir, "handlers-state.sqlite");
process.env.SF_AI_ACTOR_TYPE = "system";
process.env.SF_AI_ACTOR_ID = "test-runner";
process.env.SF_AI_ROLE = "admin";

const {
  clearOrchestrationSessionsForTest,
  invokeRegisteredToolForTest
} = await import("../../mcp/server.js");

type ToolResult = {
  content: Array<{ type: string; text: string }>;
};

async function callTool(name: string, input: unknown): Promise<ToolResult> {
  const result = await invokeRegisteredToolForTest(name, input) as ToolResult;
  assert.ok(Array.isArray(result.content));
  assert.ok(result.content.length > 0);
  return result;
}

function parseFirstJson<T>(result: ToolResult): T {
  return JSON.parse(result.content[0].text) as T;
}

test("handlers integration - proposal flow enqueue to approve", async () => {
  const suffix = Date.now().toString(36);
  const proposalName = `handlers-proposal-${suffix}`;

  const enqueued = parseFirstJson<{
    enqueued: { id: string; name: string; status: string };
  }>(await callTool("enqueue_proposal", {
    resourceType: "skills",
    name: proposalName,
    content: "# Handler Proposal\n\ncontent"
  }));

  assert.equal(enqueued.enqueued.name, proposalName);
  assert.equal(enqueued.enqueued.status, "pending");

  const approved = parseFirstJson<{
    ok: boolean;
    approved: { id: string; status: string };
    applied: boolean;
  }>(await callTool("approve_proposal", {
    id: enqueued.enqueued.id,
    apply: false
  }));

  assert.equal(approved.ok, true);
  assert.equal(approved.approved.id, enqueued.enqueued.id);
  assert.equal(approved.approved.status, "approved");
  assert.equal(approved.applied, false);
});

test("handlers integration - governance signal recording reflects state", async () => {
  const targetName = `handlers-governance-${Date.now().toString(36)}`;

  await callTool("record_resource_signal", {
    resourceType: "tools",
    name: targetName,
    usageIncrement: 2,
    bugIncrement: 1
  });

  const governance = parseFirstJson<{
    usage: { tools: Record<string, number> };
    bugSignals: { tools: Record<string, number> };
  }>(await callTool("get_resource_governance", {}));

  assert.ok((governance.usage.tools[targetName] ?? 0) >= 2);
  assert.ok((governance.bugSignals.tools[targetName] ?? 0) >= 1);
});

test("handlers integration - orchestration event flow enqueues next agent", async () => {
  clearOrchestrationSessionsForTest();

  const orchestrated = parseFirstJson<{
    sessionId: string;
    nextQueue: string[];
  }>(await callTool("orchestrate_chat", {
    topic: "handlers orchestration test",
    agents: ["architect", "qa-engineer"],
    turns: 2,
    triggerRules: [
      {
        whenAgent: "architect",
        thenAgent: "qa-engineer",
        messageIncludes: "レビュー"
      }
    ]
  }));

  assert.equal(typeof orchestrated.sessionId, "string");
  assert.ok(orchestrated.nextQueue.length > 0);

  const triggerEval = parseFirstJson<{
    nextAgents: string[];
  }>(await callTool("evaluate_triggers", {
    sessionId: orchestrated.sessionId,
    lastAgent: "architect",
    lastMessage: "レビューします",
    fallbackRoundRobin: false
  }));

  assert.ok(triggerEval.nextAgents.includes("qa-engineer"));

  const dequeued = parseFirstJson<{
    dequeued: string[];
  }>(await callTool("dequeue_next_agent", {
    sessionId: orchestrated.sessionId,
    limit: 1
  }));

  assert.equal(dequeued.dequeued.length, 1);
});

test("handlers integration - cleanup scheduler create and due evaluation", async () => {
  const scheduleName = `handlers-schedule-${Date.now().toString(36)}`;
  const evaluationTime = new Date();
  evaluationTime.setSeconds(0, 0);

  const created = parseFirstJson<{
    created?: { id: string; name: string; cron: string };
    error?: string;
  }>(await callTool("governance_auto_cleanup_schedule", {
    operation: "create",
    name: scheduleName,
    cron: "* * * * *",
    action: "dry-run"
  }));

  assert.equal(created.error, undefined);
  assert.ok(created.created?.id);
  assert.equal(created.created?.name, scheduleName);

  const due = parseFirstJson<{
    due: Array<{ id: string; name: string }>;
  }>(await callTool("governance_auto_cleanup_schedule", {
    operation: "due",
    when: evaluationTime.toISOString()
  }));

  assert.ok(Array.isArray(due.due));
  assert.ok(due.due.some((entry) => entry.name === scheduleName));
});

test("handlers integration - resource suggestion returns cleanup summary", async () => {
  const suggestion = parseFirstJson<{
    dryRun: boolean;
    candidateCount: number;
    totalAnalyzed?: number;
    reportJson: string;
    reportMarkdown: string;
  }>(await callTool("suggest_cleanup_resources", {
    daysUnused: 30,
    limit: 5,
    resourceTypes: ["skills", "tools", "presets"],
    eventLimit: 200
  }));

  assert.equal(suggestion.dryRun, true);
  assert.ok(typeof suggestion.candidateCount === "number");
  assert.ok(typeof suggestion.reportJson === "string" && suggestion.reportJson.length > 0);
  assert.ok(typeof suggestion.reportMarkdown === "string" && suggestion.reportMarkdown.length > 0);
});
