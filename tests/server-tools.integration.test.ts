import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { promises as fsPromises } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getCompletedTraces } from "../mcp/core/trace/trace-context.js";
import { execFileSync } from "node:child_process";

const serverTestOutputsDir = mkdtempSync(join(tmpdir(), "sf-ai-server-outputs-"));
process.env.SF_AI_OUTPUTS_DIR = serverTestOutputsDir;

const {
  clearOrchestrationSessionsForTest,
  invokeRegisteredToolForTest,
  listRegisteredToolNamesForTest
} = await import("../mcp/server.js");

after(() => {
  rmSync(serverTestOutputsDir, { recursive: true, force: true });
});

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

test("server exposes expected core tool registrations", () => {
  const names = listRegisteredToolNamesForTest();

  for (const required of [
    "deploy_org",
    "run_tests",
    "run_deployment_verification",
    "suggest_flow_test_cases",
    "flow_condition_simulate",
    "simulate_flow_conditions",
    "resource_dependency_graph",
    "flow_analyze",
    "permission_set_analyze",
    "permission_set_diff",
    "compare_permission_sets",
    "compare_org_metadata",
    "recommend_permission_sets",
    "metrics_summary",
    "deployment_plan_generate",
    "benchmark_suite",
    "list_agents",
    "chat",
    "pr_readiness_check",
    "security_delta_scan",
    "deployment_impact_summary",
    "changed_tests_suggest",
    "coverage_estimate",
    "analyze_test_coverage_gap",
    "metadata_dependency_graph",
    "save_orchestration_session",
    "restore_orchestration_session",
    "list_orchestration_sessions",
    "parse_and_record_chat",
    "get_agent_log",
    "get_handlers_dashboard",
    "export_handlers_statistics",
    "health_check",
    "get_tool_execution_statistics",
    "add_memory",
    "search_memory",
    "list_memory",
    "clear_memory",
    "record_skill_rating",
    "get_skill_rating_report",
    "agent_ab_test",
    "recommend_first_steps",
    "add_vector_record",
    "search_vector",
    "build_prompt",
    "get_context",
    "get_system_events",
    "get_event_automation_config",
    "update_event_automation_config",
    "simulate_governance_change",
    "suggest_cleanup_resources",
    "record_reasoning_step",
    "get_trace_reasoning",
    "proposal_feedback_learn",
  ]) {
    assert.ok(names.includes(required), `missing tool: ${required}`);
  }
});

test("simulate_flow_conditions alias returns trigger result", async () => {
  const payload = parseFirstJson<{
    flowName: string;
    shouldTrigger: boolean;
    trace: Array<{ op: string; result: boolean }>;
  }>(await callTool("simulate_flow_conditions", {
    flowName: "AliasFlow",
    record: { Status: "New", Priority: "High" },
    condition: {
      op: "all",
      conditions: [
        { op: "eq", field: "Status", value: "New" },
        { op: "eq", field: "Priority", value: "High" }
      ]
    }
  }));

  assert.equal(payload.flowName, "AliasFlow");
  assert.equal(payload.shouldTrigger, true);
  assert.ok(payload.trace.length > 0);
});

test("deploy_org returns JSON with command and dryRun", async () => {
  const result = await callTool("deploy_org", { targetOrg: "dev-org", dryRun: true });
  const payload = JSON.parse(result.content[0].text) as { command: string; dryRun: boolean };

  assert.equal(payload.dryRun, true);
  assert.ok(payload.command.includes("--target-org dev-org"));
  assert.ok(payload.command.includes("--check-only"));
});

test("run_tests returns Apex test command text", async () => {
  const result = await callTool("run_tests", { targetOrg: "qa-org" });
  const text = result.content[0].text;

  assert.ok(text.includes("sf apex run test"));
  assert.ok(text.includes("--target-org qa-org"));
});

test("run_deployment_verification returns structured decision and report paths", async () => {
  const payload = parseFirstJson<{
    mode: "dry-run" | "live";
    targetOrg: string;
    smokeTestCommand: string;
    decision: { recommendedAction: "rollback" | "continue" | "monitor"; shouldRollback: boolean };
    reportJsonPath: string;
    reportMarkdownPath: string;
  }>(await callTool("run_deployment_verification", {
    targetOrg: "qa-org",
    dryRun: false,
    deploymentSucceeded: true,
    smokeClassNames: ["OrderServiceTest"],
    smokeResult: {
      totalTests: 10,
      failedTests: 3,
      passedTests: 7,
      criticalFailures: 0
    },
    failureRateThresholdPercent: 20
  }));

  assert.equal(payload.mode, "live");
  assert.equal(payload.targetOrg, "qa-org");
  assert.ok(payload.smokeTestCommand.includes("sf apex run test"));
  assert.ok(["rollback", "continue", "monitor"].includes(payload.decision.recommendedAction));
  assert.equal(typeof payload.decision.shouldRollback, "boolean");
  assert.ok(payload.reportJsonPath.length > 0);
  assert.ok(payload.reportMarkdownPath.length > 0);
});

test("suggest_flow_test_cases returns uncovered path suggestions with report outputs", async () => {
  const flowDir = mkdtempSync(join(tmpdir(), "sf-ai-flow-cases-int-"));
  try {
    const flowPath = join(flowDir, "SampleFlow.flow-meta.xml");
    writeFileSync(
      flowPath,
      [
        "<Flow>",
        "  <label>SampleFlow</label>",
        "  <decisions>",
        "    <name>EligibilityDecision</name>",
        "    <rules>",
        "      <name>GoldTier</name>",
        "      <conditionLogic>and</conditionLogic>",
        "      <conditions>",
        "        <leftValueReference>record.Tier__c</leftValueReference>",
        "        <operator>EqualTo</operator>",
        "        <rightValue><stringValue>Gold</stringValue></rightValue>",
        "      </conditions>",
        "    </rules>",
        "    <rules>",
        "      <name>LargeDeal</name>",
        "      <conditionLogic>and</conditionLogic>",
        "      <conditions>",
        "        <leftValueReference>record.Amount__c</leftValueReference>",
        "        <operator>GreaterThan</operator>",
        "        <rightValue><numberValue>50000</numberValue></rightValue>",
        "      </conditions>",
        "    </rules>",
        "  </decisions>",
        "</Flow>"
      ].join("\n"),
      "utf-8"
    );

    const payload = parseFirstJson<{
      flowName: string;
      totalPathCount: number;
      uncoveredPathCount: number;
      uncoveredPaths: string[];
      suggestedCases: Array<{ pathId: string; simulation?: { shouldTrigger: boolean } }>;
      reportJsonPath: string;
      reportMarkdownPath: string;
    }>(await callTool("suggest_flow_test_cases", {
      filePath: flowPath,
      coveredPaths: ["EligibilityDecision.GoldTier"],
      maxCases: 20
    }));

    assert.equal(payload.flowName, "SampleFlow");
    assert.ok(payload.totalPathCount >= 2);
    assert.ok(payload.uncoveredPathCount >= 1);
    assert.ok(payload.uncoveredPaths.includes("EligibilityDecision.LargeDeal"));
    const suggested = payload.suggestedCases.find((row) => row.pathId === "EligibilityDecision.LargeDeal");
    assert.ok(suggested);
    assert.equal(suggested?.simulation?.shouldTrigger, true);

    const jsonPath = isAbsolute(payload.reportJsonPath) ? payload.reportJsonPath : resolve(process.cwd(), payload.reportJsonPath);
    const mdPath = isAbsolute(payload.reportMarkdownPath) ? payload.reportMarkdownPath : resolve(process.cwd(), payload.reportMarkdownPath);
    assert.ok(existsSync(jsonPath));
    assert.ok(existsSync(mdPath));
  } finally {
    rmSync(flowDir, { recursive: true, force: true });
  }
});

test("recommend_permission_sets returns ranked permission set candidates", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sf-ai-perm-reco-int-"));
  try {
    const candidateA = join(tempDir, "CandidateA.permissionset-meta.xml");
    const candidateB = join(tempDir, "CandidateB.permissionset-meta.xml");

    writeFileSync(
      candidateA,
      [
        "<PermissionSet>",
        "  <objectPermissions>",
        "    <object>Account</object>",
        "    <allowRead>true</allowRead>",
        "    <allowCreate>false</allowCreate>",
        "    <allowEdit>false</allowEdit>",
        "    <allowDelete>false</allowDelete>",
        "    <viewAllRecords>false</viewAllRecords>",
        "    <modifyAllRecords>false</modifyAllRecords>",
        "  </objectPermissions>",
        "  <fieldPermissions>",
        "    <field>Account.Name</field>",
        "    <readable>true</readable>",
        "    <editable>false</editable>",
        "  </fieldPermissions>",
        "</PermissionSet>"
      ].join("\n"),
      "utf-8"
    );

    writeFileSync(
      candidateB,
      [
        "<PermissionSet>",
        "  <objectPermissions>",
        "    <object>Account</object>",
        "    <allowRead>true</allowRead>",
        "    <allowCreate>true</allowCreate>",
        "    <allowEdit>true</allowEdit>",
        "    <allowDelete>true</allowDelete>",
        "    <viewAllRecords>true</viewAllRecords>",
        "    <modifyAllRecords>true</modifyAllRecords>",
        "  </objectPermissions>",
        "  <fieldPermissions>",
        "    <field>Account.Name</field>",
        "    <readable>true</readable>",
        "    <editable>true</editable>",
        "  </fieldPermissions>",
        "  <fieldPermissions>",
        "    <field>Account.Phone</field>",
        "    <readable>true</readable>",
        "    <editable>true</editable>",
        "  </fieldPermissions>",
        "</PermissionSet>"
      ].join("\n"),
      "utf-8"
    );

    const payload = parseFirstJson<{
      recommendationCount: number;
      recommendations: Array<{ permissionSetFile: string; score: number }>;
      reportJsonPath: string;
      reportMarkdownPath: string;
    }>(await callTool("recommend_permission_sets", {
      permissionSetFiles: [candidateA, candidateB],
      usage: {
        objects: ["Account"],
        fields: ["Account.Name"]
      },
      maxRecommendations: 2
    }));

    assert.equal(payload.recommendationCount, 2);
    assert.equal(payload.recommendations[0]?.permissionSetFile, candidateA);
    assert.ok(typeof payload.recommendations[0]?.score === "number");
    const jsonPath = isAbsolute(payload.reportJsonPath) ? payload.reportJsonPath : resolve(process.cwd(), payload.reportJsonPath);
    const mdPath = isAbsolute(payload.reportMarkdownPath) ? payload.reportMarkdownPath : resolve(process.cwd(), payload.reportMarkdownPath);
    assert.ok(existsSync(jsonPath));
    assert.ok(existsSync(mdPath));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("compare_permission_sets alias detects permission drift", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sf-ai-perm-diff-int-"));
  try {
    const baseline = join(tempDir, "baseline.permissionset-meta.xml");
    const target = join(tempDir, "target.permissionset-meta.xml");

    writeFileSync(
      baseline,
      [
        "<PermissionSet>",
        "  <objectPermissions>",
        "    <object>Account</object>",
        "    <allowRead>true</allowRead>",
        "    <allowCreate>false</allowCreate>",
        "    <allowEdit>false</allowEdit>",
        "    <allowDelete>false</allowDelete>",
        "    <viewAllRecords>false</viewAllRecords>",
        "    <modifyAllRecords>false</modifyAllRecords>",
        "  </objectPermissions>",
        "</PermissionSet>"
      ].join("\n"),
      "utf-8"
    );

    writeFileSync(
      target,
      [
        "<PermissionSet>",
        "  <objectPermissions>",
        "    <object>Account</object>",
        "    <allowRead>true</allowRead>",
        "    <allowCreate>true</allowCreate>",
        "    <allowEdit>true</allowEdit>",
        "    <allowDelete>false</allowDelete>",
        "    <viewAllRecords>false</viewAllRecords>",
        "    <modifyAllRecords>false</modifyAllRecords>",
        "  </objectPermissions>",
        "</PermissionSet>"
      ].join("\n"),
      "utf-8"
    );

    const payload = parseFirstJson<{
      summary: { missingCount: number; excessiveCount: number };
    }>(await callTool("compare_permission_sets", {
      baselineFilePath: baseline,
      targetFilePath: target
    }));

    assert.ok(payload.summary.missingCount > 0 || payload.summary.excessiveCount > 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resource_dependency_graph returns network graph and impact result", async () => {
  const presetDir = join(serverTestOutputsDir, "presets");
  mkdirSync(presetDir, { recursive: true });
  const presetPath = join(presetDir, "resource-graph-test.json");
  writeFileSync(
    presetPath,
    JSON.stringify(
      {
        name: "ResourceGraphTestPreset",
        description: "Resource graph integration test preset",
        topic: "resource graph",
        agents: ["architect"],
        skills: ["architecture/salesforce-architecture"],
        persona: "engineer"
      },
      null,
      2
    ),
    "utf-8"
  );

  const payload = parseFirstJson<{
    summary: {
      nodeCount: number;
      edgeCount: number;
      skills: number;
      agents: number;
      personas: number;
      presets: number;
    };
    edges: Array<{ from: string; to: string; relation: string }>;
    mermaid: string;
    impact?: {
      target: { type: string; name: string; id: string };
      upstream: Array<{ id: string }>;
      downstream: Array<{ id: string }>;
    };
    reportJsonPath: string;
    reportMarkdownPath: string;
  }>(await callTool("resource_dependency_graph", {
    includeTypes: ["skills", "agents", "personas", "presets"],
    includeIsolated: false,
    impactTarget: { type: "presets", name: "ResourceGraphTestPreset" },
    maxImpacts: 50
  }));

  assert.ok(payload.summary.nodeCount > 0);
  assert.ok(payload.summary.edgeCount > 0);
  assert.ok(payload.summary.presets > 0);
  assert.ok(payload.edges.some((edge) => edge.from.startsWith("presets:") && edge.relation === "includes"));
  assert.ok(payload.mermaid.startsWith("graph LR"));
  assert.ok(payload.impact);
  assert.equal(payload.impact?.target.type, "presets");

  const jsonPath = isAbsolute(payload.reportJsonPath) ? payload.reportJsonPath : resolve(process.cwd(), payload.reportJsonPath);
  const mdPath = isAbsolute(payload.reportMarkdownPath) ? payload.reportMarkdownPath : resolve(process.cwd(), payload.reportMarkdownPath);
  assert.ok(existsSync(jsonPath));
  assert.ok(existsSync(mdPath));
});

test("record_skill_rating and get_skill_rating_report generate report and flag low trend", async () => {
  const saved = parseFirstJson<{
    saved: boolean;
    totalRatingCount: number;
    flaggedForRefactor: string[];
    reportJsonPath: string;
    reportMarkdownPath: string;
  }>(await callTool("record_skill_rating", {
    ratings: [
      {
        skill: "apex/trigger-audit",
        rating: 5
      },
      {
        skill: "apex/trigger-audit",
        rating: 2
      },
      {
        skill: "security/permission-audit",
        rating: 2
      }
    ],
    recentWindow: 2,
    lowRatingThreshold: 3,
    trendDropThreshold: 0.5
  }));

  assert.equal(saved.saved, true);
  assert.ok(saved.totalRatingCount >= 3);
  const savedMarkdown = isAbsolute(saved.reportMarkdownPath)
    ? saved.reportMarkdownPath
    : resolve(process.cwd(), saved.reportMarkdownPath);
  assert.ok(existsSync(savedMarkdown));

  const report = parseFirstJson<{
    totalRatingCount: number;
    averageRating: number;
    flaggedForRefactor: string[];
    skills: Array<{ skill: string; averageRating: number; flaggedForRefactor: boolean }>;
    reportMarkdownPath: string;
  }>(await callTool("get_skill_rating_report", {
    recentWindow: 2,
    lowRatingThreshold: 3,
    trendDropThreshold: 0.5,
    maxSkills: 20
  }));

  assert.equal(typeof report.totalRatingCount, "number");
  assert.equal(typeof report.averageRating, "number");
  assert.ok(Array.isArray(report.flaggedForRefactor));
  assert.ok(Array.isArray(report.skills));
  const markdownPath = isAbsolute(report.reportMarkdownPath)
    ? report.reportMarkdownPath
    : resolve(process.cwd(), report.reportMarkdownPath);
  assert.ok(existsSync(markdownPath));
});

test("agent_ab_test compares two agents and writes comparison report", async () => {
  const payload = parseFirstJson<{
    comparison: string;
    winner: { byQuality: string; byLatency: string; overall: string };
    runs: {
      agentA: { agent: string; qualityScore: number; durationMs: number; promptChars: number };
      agentB: { agent: string; qualityScore: number; durationMs: number; promptChars: number };
    };
    reportJsonPath: string;
    reportMarkdownPath: string;
  }>(await callTool("agent_ab_test", {
    topic: "Salesforce release readiness checklist",
    agentA: "architect",
    agentB: "qa-engineer",
    skills: ["architecture/salesforce-architecture", "testing/apex-test"],
    turns: 4
  }));

  assert.equal(payload.comparison, "architect vs qa-engineer");
  assert.ok(["architect", "qa-engineer"].includes(payload.winner.byQuality));
  assert.ok(["architect", "qa-engineer"].includes(payload.winner.byLatency));
  assert.ok(["architect", "qa-engineer"].includes(payload.winner.overall));
  assert.equal(payload.runs.agentA.agent, "architect");
  assert.equal(payload.runs.agentB.agent, "qa-engineer");
  assert.ok(payload.runs.agentA.promptChars > 0);
  assert.ok(payload.runs.agentB.promptChars > 0);

  const jsonPath = isAbsolute(payload.reportJsonPath) ? payload.reportJsonPath : resolve(process.cwd(), payload.reportJsonPath);
  const markdownPath = isAbsolute(payload.reportMarkdownPath) ? payload.reportMarkdownPath : resolve(process.cwd(), payload.reportMarkdownPath);
  assert.ok(existsSync(jsonPath));
  assert.ok(existsSync(markdownPath));
});

test("agent_ab_test applies winner/loser outcomes to trust store when requested", async () => {
  const trustStorePath = join(serverTestOutputsDir, "agent-trust-histories.json");
  if (existsSync(trustStorePath)) {
    await fsPromises.rm(trustStorePath);
  }
  const payload = parseFirstJson<{
    winner: { overall: string };
    runs: { agentA: { agent: string }; agentB: { agent: string } };
    trustStoreApplied?: {
      filePath: string;
      winnerAgent: string;
      loserAgent: string;
      histories: Record<string, { accepted: number; rejected: number }>;
    };
  }>(await callTool("agent_ab_test", {
    topic: "Apex governor limit deep dive",
    agentA: "architect",
    agentB: "qa-engineer",
    skills: ["architecture/salesforce-architecture", "testing/apex-test"],
    turns: 3,
    applyOutcomeToTrustStore: true,
    trustStoreFilePath: trustStorePath
  }));

  assert.ok(payload.trustStoreApplied, "trustStoreApplied payload should be present");
  assert.equal(payload.trustStoreApplied?.filePath, trustStorePath);
  assert.equal(payload.trustStoreApplied?.winnerAgent, payload.winner.overall);
  const winnerHistory = payload.trustStoreApplied?.histories[payload.winner.overall];
  const loserHistory = payload.trustStoreApplied?.histories[payload.trustStoreApplied?.loserAgent ?? ""];
  assert.ok(winnerHistory && winnerHistory.accepted >= 1, "winner accepted count should be incremented");
  assert.ok(loserHistory && loserHistory.rejected >= 1, "loser rejected count should be incremented");
  assert.ok(existsSync(trustStorePath), "trust store file should be created");
});

test("proposal_feedback_learn updates query-skill incremental model with versioned output", async () => {
  const payload = parseFirstJson<{
    saved: boolean;
    querySkillModelVersion: string;
    querySkillLogFile: string;
    querySkillModelFile: string;
    querySkillFeedbackCount: number;
  }>(await callTool("proposal_feedback_learn", {
    feedback: [
      {
        resourceType: "skills",
        name: "security/security-rules",
        decision: "accepted",
        topic: "release security checklist"
      },
      {
        resourceType: "skills",
        name: "security/security-rules",
        decision: "accepted",
        topic: "release security checklist"
      }
    ],
    minSamples: 1
  }));

  assert.equal(payload.saved, true);
  assert.equal(payload.querySkillModelVersion, "query-skill-v1");
  assert.ok(payload.querySkillFeedbackCount >= 2);

  const querySkillLogPath = isAbsolute(payload.querySkillLogFile)
    ? payload.querySkillLogFile
    : resolve(process.cwd(), payload.querySkillLogFile);
  const querySkillModelPath = isAbsolute(payload.querySkillModelFile)
    ? payload.querySkillModelFile
    : resolve(process.cwd(), payload.querySkillModelFile);
  assert.ok(existsSync(querySkillLogPath));
  assert.ok(existsSync(querySkillModelPath));
});

test("proposal_feedback_learn captures structured rejection reasons", async () => {
  const payload = parseFirstJson<{
    saved: boolean;
    totals: {
      accepted: number;
      rejected: number;
      total: number;
      rejectReasons: Record<"reject_inaccurate" | "reject_unnecessary" | "reject_duplicate", number>;
    };
    topLearnedResources: Array<{
      resourceType: string;
      name: string;
      rejected: number;
      rejectReasons: Record<"reject_inaccurate" | "reject_unnecessary" | "reject_duplicate", number>;
    }>;
  }>(await callTool("proposal_feedback_learn", {
    feedback: [
      { resourceType: "skills", name: "apex/apex-trigger-handler", decision: "reject_inaccurate", topic: "trigger framework" },
      { resourceType: "skills", name: "apex/apex-trigger-handler", decision: "reject_duplicate", topic: "trigger framework" },
      { resourceType: "skills", name: "apex/apex-trigger-handler", decision: "rejected", topic: "trigger framework" },
      { resourceType: "skills", name: "apex/apex-trigger-handler", decision: "accepted", topic: "trigger framework" }
    ],
    minSamples: 1
  }));

  assert.equal(payload.saved, true);
  assert.ok(payload.totals.rejected >= 3, "rejected total should aggregate all reject variants");
  assert.ok(payload.totals.rejectReasons.reject_inaccurate >= 1, "reject_inaccurate should be tracked");
  assert.ok(payload.totals.rejectReasons.reject_duplicate >= 1, "reject_duplicate should be tracked");
  assert.ok(payload.totals.rejectReasons.reject_unnecessary >= 1, "legacy 'rejected' should map to reject_unnecessary");

  const targetResource = payload.topLearnedResources.find(
    (row) => row.resourceType === "skills" && row.name === "apex/apex-trigger-handler"
  );
  assert.ok(targetResource, "target resource summary should be present");
  assert.ok(targetResource!.rejectReasons.reject_inaccurate >= 1);
  assert.ok(targetResource!.rejectReasons.reject_duplicate >= 1);
  assert.ok(targetResource!.rejectReasons.reject_unnecessary >= 1);
});

test("visualize_feedback_loop summarizes feedback timeline and heatmap from learned entries", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const topic = `auto-memory-loop-topic-${suffix}`;
  const skillName = `auto-memory-loop-skill-${suffix}`;
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  await callTool("proposal_feedback_learn", {
    feedback: [
      {
        resourceType: "skills",
        name: skillName,
        decision: "accepted",
        topic,
        recordedAt: now.toISOString()
      },
      {
        resourceType: "skills",
        name: skillName,
        decision: "accepted",
        topic,
        recordedAt: oneDayAgo.toISOString()
      },
      {
        resourceType: "skills",
        name: skillName,
        decision: "reject_duplicate",
        topic,
        recordedAt: oneDayAgo.toISOString()
      },
      {
        resourceType: "skills",
        name: skillName,
        decision: "reject_inaccurate",
        topic,
        recordedAt: twoDaysAgo.toISOString()
      }
    ],
    minSamples: 1
  });

  const payload = parseFirstJson<{
    totals: {
      accepted: number;
      rejected: number;
      total: number;
      acceptRate: number;
    };
    rejectReasonShare: Record<string, number>;
    timeline: Array<{ date: string; accepted: number; rejected: number; acceptRate: number }>;
    heatmap: Array<{
      topic: string;
      resource: string;
      accepted: number;
      rejected: number;
      total: number;
      acceptRate: number;
    }>;
  }>(await callTool("visualize_feedback_loop", {
    periodDays: 30,
    trendWindowDays: 14,
    minSamples: 1,
    topResources: 20,
    topTopics: 50
  }));

  const targetCell = payload.heatmap.find((cell) => cell.topic === topic && cell.resource === skillName);
  assert.ok(targetCell, "heatmap should include feedback pair registered in proposal_feedback_learn");
  assert.equal(targetCell!.accepted, 2);
  assert.equal(targetCell!.rejected, 2);
  assert.equal(targetCell!.total, 4);

  assert.ok(payload.totals.total >= 4);
  assert.ok(payload.rejectReasonShare.reject_duplicate > 0);
  assert.ok(payload.rejectReasonShare.reject_inaccurate > 0);
  assert.ok(payload.timeline.length > 0);
});

test("metrics_summary returns trace-based summary fields", async () => {
  const result = await callTool("metrics_summary", { limit: 50 });
  const payload = JSON.parse(result.content[0].text) as {
    activeCount: number;
    completedCount: number;
    successRate: number;
    errorRate: number;
  };

  assert.equal(typeof payload.activeCount, "number");
  assert.equal(typeof payload.completedCount, "number");
  assert.equal(typeof payload.successRate, "number");
  assert.equal(typeof payload.errorRate, "number");
});

test("benchmark_suite returns grade and recommendations", async () => {
  const result = await callTool("benchmark_suite", {
    recentTraceLimit: 100,
    scenarios: ["Apex review", "Release readiness"]
  });
  const payload = JSON.parse(result.content[0].text) as {
    overallScore: number;
    grade: "A" | "B" | "C" | "D";
    recommendations: string[];
  };

  assert.equal(typeof payload.overallScore, "number");
  assert.ok(["A", "B", "C", "D"].includes(payload.grade));
  assert.ok(Array.isArray(payload.recommendations));
});

test("deployment_plan_generate returns risk and plan sections", async () => {
  const repoPath = mkdtempSync(join(tmpdir(), "sf-ai-deploy-plan-int-"));
  try {
    const git = (args: string[]) => execFileSync("git", args, { cwd: repoPath, encoding: "utf-8" });
    git(["init"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "test-user"]);
    git(["checkout", "-b", "main"]);
    writeFileSync(join(repoPath, "README.md"), "# test\n", "utf-8");
    git(["add", "."]);
    git(["commit", "-m", "base"]);
    git(["checkout", "-b", "feature/test"]);
    writeFileSync(join(repoPath, "README.md"), "# test\n\nchange\n", "utf-8");
    git(["add", "."]);
    git(["commit", "-m", "change"]);

    const result = await callTool("deployment_plan_generate", {
      repoPath,
      baseBranch: "main",
      workingBranch: "feature/test"
    });
    const payload = JSON.parse(result.content[0].text) as {
      riskLevel: "low" | "medium" | "high";
      recommendedOrder: string[];
      preChecks: string[];
      postChecks: string[];
      rollbackHints: string[];
    };

    assert.ok(["low", "medium", "high"].includes(payload.riskLevel));
    assert.ok(payload.recommendedOrder.length > 0);
    assert.ok(payload.preChecks.length > 0);
    assert.ok(payload.postChecks.length > 0);
    assert.ok(payload.rollbackHints.length > 0);
  } finally {
    rmSync(repoPath, { recursive: true, force: true });
  }
});

test("apply_resource_actions writes audit trail metadata", async () => {
  const result = await callTool("apply_resource_actions", {
    dryRun: true,
    actions: [
      {
        resourceType: "tools",
        action: "disable",
        name: "run_tests"
      }
    ]
  });

  const payload = JSON.parse(result.content[0].text) as {
    auditFile?: string;
  };

  assert.equal(typeof payload.auditFile, "string");
  const expectedAuditPath = join(serverTestOutputsDir, "audit", "resource-actions.jsonl");
  assert.ok(existsSync(expectedAuditPath));
  const content = readFileSync(expectedAuditPath, "utf-8");
  assert.ok(content.includes("apply_resource_actions"));
});

test("reasoning trace tools record and visualize Think/Do/Check chain", async () => {
  await callTool("deploy_org", { targetOrg: "trace-org", dryRun: true });
  const deployTrace = getCompletedTraces(20).find((trace) => trace.toolName === "deploy_org");
  assert.ok(deployTrace, "deploy_org trace should exist");

  await callTool("record_reasoning_step", {
    traceId: deployTrace!.traceId,
    stage: "think",
    message: "リスクを確認する",
    agent: "architect"
  });

  await callTool("record_reasoning_step", {
    traceId: deployTrace!.traceId,
    stage: "do",
    message: "チェック専用デプロイを実行する",
    agent: "release-manager"
  });

  await callTool("record_reasoning_step", {
    traceId: deployTrace!.traceId,
    stage: "check",
    message: "結果を検証して次アクションを決める",
    agent: "qa-engineer"
  });

  const allView = parseFirstJson<{
    traceId: string;
    steps: Array<{ stage: string; message: string }>;
    markdown: string;
    mermaid: string;
  }>(await callTool("get_trace_reasoning", {
    traceId: deployTrace!.traceId,
    format: "all"
  }));

  assert.equal(allView.traceId, deployTrace!.traceId);
  assert.equal(allView.steps.length, 3);
  assert.ok(allView.steps.some((step) => step.stage === "think"));
  assert.ok(allView.steps.some((step) => step.stage === "do"));
  assert.ok(allView.steps.some((step) => step.stage === "check"));
  assert.ok(allView.markdown.includes("# Trace Reasoning"));
  assert.ok(allView.markdown.includes("Think"));
  assert.ok(allView.mermaid.includes("sequenceDiagram"));
});

test("list_agents returns JSON array with name and summary", async () => {
  const result = await callTool("list_agents", {});
  const payload = JSON.parse(result.content[0].text) as Array<{ name: string; summary: string }>;

  assert.ok(payload.length > 0);
  assert.equal(typeof payload[0]?.name, "string");
  assert.equal(typeof payload[0]?.summary, "string");
});

test("recommend_first_steps returns picks and 3-step guidance", async () => {
  const result = await callTool("recommend_first_steps", {
    goal: "Apex trigger review",
    limitPerType: 2
  });
  const payload = JSON.parse(result.content[0].text) as {
    goal: string;
    selected: {
      agents: string[];
      skills: string[];
      personas: string[];
      docs: string[];
    };
    firstSteps: Array<{ step: number; title: string; action: string }>;
  };

  assert.equal(payload.goal, "Apex trigger review");
  assert.ok(Array.isArray(payload.selected.agents));
  assert.ok(Array.isArray(payload.selected.skills));
  assert.ok(Array.isArray(payload.selected.personas));
  assert.ok(Array.isArray(payload.selected.docs));
  assert.equal(payload.firstSteps.length, 3);
});

test("health_check returns operational summary", async () => {
  const result = await callTool("health_check", {});
  const payload = JSON.parse(result.content[0].text) as {
    status: string;
    checkedAt: string;
    toolExecutions: {
      sampled: number;
      totals: {
        total: number;
        success: number;
        failure: number;
        blockedByDisable: number;
      };
      rates: {
        successRate: number;
        failureRate: number;
      };
    };
    disabledResources: {
      skills: number;
      tools: number;
      presets: number;
    };
    eventLogs: {
      eventDir: string;
      activeLogPath: string;
      activeLogExists: boolean;
      activeLogSizeBytes: number;
      archiveCount: number;
      archiveTotalSizeBytes: number;
      archives: Array<{ file: string; sizeBytes: number; modifiedAt: string }>;
    };
    governanceValidation?: {
      duplicateEntries: {
        disabledSkills: string[];
        disabledTools: string[];
        disabledPresets: string[];
        protectedTools: string[];
      };
      configSanity: {
        maxCountsPositive: boolean;
        retryWindowValid: boolean;
        thresholdsNonNegative: boolean;
      };
    };
    governanceWarnings?: string[];
    traces?: {
      activeCount: number;
      recentCompletedCount: number;
      recentCompleted: Array<unknown>;
    };
    metrics?: {
      totalCalls: number;
      totalErrors: number;
      overallSuccessRate: number;
      overallAvgDurationMs: number;
      topTools: Array<unknown>;
    };
  };

  assert.equal(payload.status, "ok");
  assert.equal(typeof payload.checkedAt, "string");
  assert.equal(typeof payload.toolExecutions.sampled, "number");
  assert.equal(typeof payload.disabledResources.tools, "number");
  assert.equal(typeof payload.eventLogs.activeLogExists, "boolean");
  assert.equal(typeof payload.eventLogs.archiveCount, "number");
  assert.ok(Array.isArray(payload.eventLogs.archives));
  assert.ok(payload.governanceValidation);
  assert.equal(typeof payload.governanceValidation?.configSanity.maxCountsPositive, "boolean");
  assert.ok(Array.isArray(payload.governanceWarnings));
  assert.equal(typeof payload.traces?.activeCount, "number");
  assert.equal(typeof payload.traces?.recentCompletedCount, "number");
  assert.ok(Array.isArray(payload.traces?.recentCompleted));
  assert.equal(typeof payload.metrics?.totalCalls, "number");
  assert.equal(typeof payload.metrics?.overallSuccessRate, "number");
  assert.ok(Array.isArray(payload.metrics?.topTools));
});

test("chat returns prompt skeleton containing topic section", async () => {
  const result = await callTool("chat", {
    topic: "Apexトリガー改善",
    agents: ["architect", "qa-engineer"],
    skills: ["apex/apex-best-practices"],
    turns: 3
  });

  const prompt = result.content[0].text;
  assert.ok(prompt.includes("トピック: 「Apexトリガー改善」"));
  assert.ok(prompt.includes("## 参加エージェント定義"));
  assert.ok(prompt.includes("発言形式は必ず「**agent-name**: 発言内容」を使う"));
});

test("orchestration tools execute end-to-end session flow", async () => {
  const orchestrated = parseFirstJson<{
    sessionId: string;
    mode: string;
    nextQueue: string[];
    triggerRuleCount: number;
  }>(await callTool("orchestrate_chat", {
    topic: "オーケストレーションE2Eテスト",
    agents: ["architect", "qa-engineer"],
    turns: 4,
    triggerRules: [
      {
        whenAgent: "architect",
        thenAgent: "qa-engineer",
        messageIncludes: "テスト"
      }
    ]
  }));

  assert.ok(orchestrated.sessionId.startsWith("orch-"));
  assert.equal(orchestrated.mode, "pseudo-hook");
  assert.equal(orchestrated.triggerRuleCount, 1);
  assert.deepEqual(orchestrated.nextQueue, ["architect", "qa-engineer"]);

  const dequeued = parseFirstJson<{
    sessionId: string;
    dequeued: string[];
    remainingQueue: string[];
  }>(await callTool("dequeue_next_agent", {
    sessionId: orchestrated.sessionId,
    limit: 1
  }));

  assert.equal(dequeued.sessionId, orchestrated.sessionId);
  assert.deepEqual(dequeued.dequeued, ["architect"]);
  assert.deepEqual(dequeued.remainingQueue, ["qa-engineer"]);

  const evaluated = parseFirstJson<{
    sessionId: string;
    nextAgents: string[];
    usedRoundRobinFallback: boolean;
    queueLength: number;
  }>(await callTool("evaluate_triggers", {
    sessionId: orchestrated.sessionId,
    lastAgent: "architect",
    lastMessage: "テスト観点を追加します"
  }));

  assert.equal(evaluated.sessionId, orchestrated.sessionId);
  assert.ok(evaluated.nextAgents.includes("qa-engineer"));
  assert.equal(evaluated.usedRoundRobinFallback, false);
  assert.ok(evaluated.queueLength >= 2);

  const session = parseFirstJson<{
    id: string;
    queue: string[];
    historyCount: number;
    firedRuleCount: number;
  }>(await callTool("get_orchestration_session", {
    sessionId: orchestrated.sessionId
  }));

  assert.equal(session.id, orchestrated.sessionId);
  assert.ok(session.queue.length >= 2);
  assert.equal(session.historyCount, 1);
  assert.equal(session.firedRuleCount, 1);
});

test("orchestration evaluate_triggers honors once rules and uses round-robin fallback", async () => {
  const orchestrated = parseFirstJson<{
    sessionId: string;
  }>(await callTool("orchestrate_chat", {
    topic: "once rule test",
    agents: ["architect", "qa-engineer"],
    triggerRules: [
      {
        whenAgent: "architect",
        thenAgent: "debug-specialist",
        messageIncludes: "実装",
        once: true
      }
    ]
  }));

  const firstEval = parseFirstJson<{
    nextAgents: string[];
    usedRoundRobinFallback: boolean;
  }>(await callTool("evaluate_triggers", {
    sessionId: orchestrated.sessionId,
    lastAgent: "architect",
    lastMessage: "実装方針を確定します",
    enableTrustScoring: false
  }));

  assert.deepEqual(firstEval.nextAgents, ["debug-specialist"]);
  assert.equal(firstEval.usedRoundRobinFallback, false);

  const secondEval = parseFirstJson<{
    nextAgents: string[];
    usedRoundRobinFallback: boolean;
  }>(await callTool("evaluate_triggers", {
    sessionId: orchestrated.sessionId,
    lastAgent: "architect",
    lastMessage: "実装を続行します",
    enableTrustScoring: false
  }));

  assert.deepEqual(secondEval.nextAgents, ["qa-engineer"]);
  assert.equal(secondEval.usedRoundRobinFallback, true);
});

test("orchestration evaluate_triggers can disable round-robin fallback", async () => {
  const orchestrated = parseFirstJson<{
    sessionId: string;
  }>(await callTool("orchestrate_chat", {
    topic: "fallback off test",
    agents: ["architect", "qa-engineer"],
    triggerRules: [
      {
        whenAgent: "architect",
        thenAgent: "qa-engineer",
        messageIncludes: "検出しない語"
      }
    ]
  }));

  const evaluated = parseFirstJson<{
    nextAgents: string[];
    usedRoundRobinFallback: boolean;
  }>(await callTool("evaluate_triggers", {
    sessionId: orchestrated.sessionId,
    lastAgent: "architect",
    lastMessage: "この文章は条件に一致しません",
    fallbackRoundRobin: false,
    enableTrustScoring: false
  }));

  assert.deepEqual(evaluated.nextAgents, []);
  assert.equal(evaluated.usedRoundRobinFallback, false);
});

test("orchestration evaluate_triggers escalates when trust scoring falls below threshold", async () => {
  const orchestrated = parseFirstJson<{
    sessionId: string;
  }>(await callTool("orchestrate_chat", {
    topic: "security review escalation",
    agents: ["architect", "qa-engineer", "security-engineer"],
    triggerRules: []
  }));

  const evaluated = parseFirstJson<{
    nextAgents: string[];
    trustScoring?: {
      enabled: boolean;
      score?: number;
      threshold?: number;
      belowThreshold?: boolean;
      escalatedAgents?: string[];
    };
  }>(await callTool("evaluate_triggers", {
    sessionId: orchestrated.sessionId,
    lastAgent: "architect",
    lastMessage: "unrelated message with low context overlap",
    fallbackRoundRobin: false,
    enableTrustScoring: true,
    trustThreshold: 0.95,
    agentFeedback: "reject"
  }));

  assert.equal(evaluated.trustScoring?.enabled, true);
  assert.equal(evaluated.trustScoring?.belowThreshold, true);
  assert.ok((evaluated.trustScoring?.escalatedAgents?.length ?? 0) >= 1);
  assert.ok(evaluated.nextAgents.length >= 1);
});

test("orchestration tools restore saved session automatically when memory is cleared", async () => {
  const orchestrated = parseFirstJson<{
    sessionId: string;
  }>(await callTool("orchestrate_chat", {
    topic: "restore fallback test",
    agents: ["architect", "qa-engineer"],
    turns: 2
  }));

  const saved = parseFirstJson<{
    saved: boolean;
    sessionId: string;
  }>(await callTool("save_orchestration_session", {
    sessionId: orchestrated.sessionId
  }));

  assert.equal(saved.saved, true);
  clearOrchestrationSessionsForTest();

  const evaluated = parseFirstJson<{
    sessionId: string;
    nextAgents: string[];
    queueLength: number;
  }>(await callTool("evaluate_triggers", {
    sessionId: orchestrated.sessionId,
    lastAgent: "architect",
    lastMessage: "次の担当へ引き継ぎます"
  }));

  assert.equal(evaluated.sessionId, orchestrated.sessionId);
  assert.ok(evaluated.queueLength >= 2);

  const session = parseFirstJson<{
    id: string;
    historyCount: number;
  }>(await callTool("get_orchestration_session", {
    sessionId: orchestrated.sessionId
  }));

  assert.equal(session.id, orchestrated.sessionId);
  assert.equal(session.historyCount, 1);
});

test("parse_and_record_chat and get_agent_log return expected JSON structure", async () => {
  const before = await callTool("get_agent_log", {});
  const beforePayload = JSON.parse(before.content[0].text) as { total: number };

  const parseResult = await callTool("parse_and_record_chat", {
    topic: "integration-test",
    chatText: "**architect**: 設計を見直します\n**qa-engineer**: 回帰テストを追加します"
  });

  const parsed = JSON.parse(parseResult.content[0].text) as {
    recorded: number;
    topic: string | null;
    agents: string[];
    totalLogCount: number;
  };

  assert.equal(parsed.recorded, 2);
  assert.equal(parsed.topic, "integration-test");
  assert.ok(parsed.agents.includes("architect"));
  assert.ok(parsed.agents.includes("qa-engineer"));
  assert.ok(parsed.totalLogCount >= beforePayload.total + 2);

  const logResult = await callTool("get_agent_log", { agent: "architect", limit: 5 });
  const logPayload = JSON.parse(logResult.content[0].text) as {
    total: number;
    filtered: number;
    agents: string[];
    entries: Array<{ agent: string; message: string; timestamp: string; topic?: string }>;
  };

  assert.ok(logPayload.total >= beforePayload.total + 2);
  assert.ok(logPayload.filtered >= 1);
  assert.ok(Array.isArray(logPayload.entries));
  assert.ok(logPayload.entries.every((e) => e.agent === "architect"));
});

  test("get_tool_execution_statistics returns rates, windows, timeline and disabled tool counts", async () => {
    await callTool("chat", {
      topic: "統計確認",
      agents: ["architect"],
      turns: 1
    });

    const stats = parseFirstJson<{
      totals: {
        total: number;
        success: number;
        failure: number;
        blockedByDisable: number;
      };
      rates: {
        successRate: number;
        failureRate: number;
      };
      disabledTools: {
        count: number;
        names: string[];
      };
      windows: Array<{
        windowMinutes: number;
        sampledEvents: number;
        rates: {
          successRate: number;
          failureRate: number;
        };
      }>;
      timeline: Array<{
        bucketStart: string;
        bucketMinutes: number;
        rates: {
          successRate: number;
          failureRate: number;
        };
      }>;
    }>(await callTool("get_tool_execution_statistics", {
      windowMinutes: 120,
      windowsMinutes: [60, 120],
      bucketMinutes: 60,
      limit: 1000
    }));

    assert.ok(stats.totals.total >= 1);
    assert.ok(stats.totals.success >= 1);
    assert.ok(stats.rates.successRate >= 0 && stats.rates.successRate <= 100);
    assert.ok(stats.rates.failureRate >= 0 && stats.rates.failureRate <= 100);
    assert.ok(stats.disabledTools.count >= 0);
    assert.ok(Array.isArray(stats.disabledTools.names));
    assert.ok(stats.windows.length >= 2);
    assert.ok(stats.windows.some((w) => w.windowMinutes === 60));
    assert.ok(stats.timeline.length >= 1);
    assert.equal(stats.timeline[0].bucketMinutes, 60);
  });

test("event automation config can be retrieved and updated", async () => {
  const before = parseFirstJson<{
    enabled: boolean;
    protectedTools: string[];
    rules: {
      errorAggregateDetected: { autoDisableTool: boolean };
      governanceThresholdExceeded: { autoDisableRecommendedTools: boolean; maxToolsPerRun: number };
    };
  }>(await callTool("get_event_automation_config", {}));

  try {
    const updated = parseFirstJson<{
      updated: boolean;
      eventAutomation: {
        enabled: boolean;
        protectedTools: string[];
        rules: {
          errorAggregateDetected: { autoDisableTool: boolean };
          governanceThresholdExceeded: { autoDisableRecommendedTools: boolean; maxToolsPerRun: number };
        };
      };
    }>(await callTool("update_event_automation_config", {
      enabled: true,
      governanceThresholdExceeded: {
        autoDisableRecommendedTools: true,
        maxToolsPerRun: 2
      }
    }));

    assert.equal(updated.updated, true);
    assert.equal(updated.eventAutomation.enabled, true);
    assert.equal(updated.eventAutomation.rules.governanceThresholdExceeded.autoDisableRecommendedTools, true);
    assert.equal(updated.eventAutomation.rules.governanceThresholdExceeded.maxToolsPerRun, 2);
    assert.ok(updated.eventAutomation.protectedTools.includes("get_system_events"));
  } finally {
    await callTool("update_event_automation_config", {
      enabled: before.enabled,
      protectedTools: before.protectedTools,
      errorAggregateDetected: before.rules.errorAggregateDetected,
      governanceThresholdExceeded: before.rules.governanceThresholdExceeded
    });
  }
});

test("error aggregate event auto-disables an unprotected failing tool", async () => {
  const configBefore = parseFirstJson<{
    enabled: boolean;
    protectedTools: string[];
    rules: {
      errorAggregateDetected: { autoDisableTool: boolean };
      governanceThresholdExceeded: { autoDisableRecommendedTools: boolean; maxToolsPerRun: number };
    };
  }>(await callTool("get_event_automation_config", {}));

  await callTool("apply_resource_actions", {
    actions: [
      {
        resourceType: "tools",
        action: "enable",
        name: "get_agent"
      }
    ]
  });

  try {
    await callTool("update_event_automation_config", {
      enabled: true,
      protectedTools: configBefore.protectedTools.filter((name) => name !== "get_agent"),
      errorAggregateDetected: {
        autoDisableTool: true
      }
    });

    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        invokeRegisteredToolForTest("get_agent", { name: "missing-agent-for-automation-test" })
      );
    }

    const governance = parseFirstJson<{
      disabled: { tools: string[] };
    }>(await callTool("get_resource_governance", {}));
    assert.ok(governance.disabled.tools.includes("get_agent"));

    const events = parseFirstJson<{
      count: number;
      events: Array<{
        event: string;
        payload: {
          toolName?: string;
          automation?: { action?: string; toolName?: string; reason?: string };
        };
      }>;
    }>(await callTool("get_system_events", {
      event: "error_aggregate_detected",
      limit: 20
    }));

    const matching = [...events.events].reverse().find((item) => item.payload.toolName === "get_agent");
    assert.ok(matching);
    assert.equal(matching?.payload.automation?.action, "disable-tool");
    assert.equal(matching?.payload.automation?.toolName, "get_agent");
  } finally {
    await callTool("apply_resource_actions", {
      actions: [
        {
          resourceType: "tools",
          action: "enable",
          name: "get_agent"
        }
      ]
    });
    await callTool("update_event_automation_config", {
      enabled: configBefore.enabled,
      protectedTools: configBefore.protectedTools,
      errorAggregateDetected: configBefore.rules.errorAggregateDetected,
      governanceThresholdExceeded: configBefore.rules.governanceThresholdExceeded
    });
  }
});

test("simulate_governance_change evaluates delta without mutating governance state", async () => {
  const before = parseFirstJson<{
    config: {
      maxCounts: { skills: number; tools: number; presets: number };
      thresholds: { minUsageToKeep: number; bugSignalToFlag: number };
    };
    disabled: { tools: string[] };
  }>(await callTool("get_resource_governance", {}));

  const simulated = parseFirstJson<{
    deltas: {
      maxCounts: { tools: { before: number; after: number; diff: number } };
      thresholds: { minUsageToKeep: { before: number; after: number; diff: number } };
    };
    current: { recommendationCount: number };
    proposed: { recommendationCount: number };
  }>(await callTool("simulate_governance_change", {
    updateMaxCounts: {
      tools: Math.max(1, before.config.maxCounts.tools - 1)
    },
    updateThresholds: {
      minUsageToKeep: before.config.thresholds.minUsageToKeep + 1
    },
    previewLimit: 20
  }));

  assert.equal(typeof simulated.deltas.maxCounts.tools.diff, "number");
  assert.equal(typeof simulated.deltas.thresholds.minUsageToKeep.diff, "number");
  assert.equal(typeof simulated.current.recommendationCount, "number");
  assert.equal(typeof simulated.proposed.recommendationCount, "number");

  const after = parseFirstJson<{
    config: {
      maxCounts: { skills: number; tools: number; presets: number };
      thresholds: { minUsageToKeep: number; bugSignalToFlag: number };
    };
    disabled: { tools: string[] };
  }>(await callTool("get_resource_governance", {}));

  assert.deepEqual(after.config.maxCounts, before.config.maxCounts);
  assert.deepEqual(after.config.thresholds, before.config.thresholds);
  assert.deepEqual(after.disabled.tools, before.disabled.tools);
});

test("analyze_test_coverage_gap returns CI-gate compatible result", async () => {
  const repoPath = mkdtempSync(join(tmpdir(), "sf-ai-coverage-gap-int-"));
  try {
    const git = (args: string[]) => execFileSync("git", args, { cwd: repoPath, encoding: "utf-8" });
    git(["init"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "test-user"]);
    git(["checkout", "-b", "main"]);

    mkdirSync(join(repoPath, "force-app", "main", "default", "classes"), { recursive: true });

    writeFileSync(
      join(repoPath, "force-app", "main", "default", "classes", "OrderService.cls"),
      "public with sharing class OrderService { public static void run() {} }\n",
      "utf-8"
    );
    git(["add", "."]);
    git(["commit", "-m", "base"]);

    git(["checkout", "-b", "feature/no-test"]);
    writeFileSync(
      join(repoPath, "force-app", "main", "default", "classes", "OrderService.cls"),
      "public with sharing class OrderService { public static void run(){ System.debug('v2'); } }\n",
      "utf-8"
    );
    git(["add", "."]);
    git(["commit", "-m", "change without test"]);

    const payload = parseFirstJson<{
      hasCoverageGap: boolean;
      gapCount: number;
      ciGate: { pass: boolean; suggestedExitCode: number };
      reportJsonPath: string;
      reportMarkdownPath: string;
    }>(await callTool("analyze_test_coverage_gap", {
      repoPath,
      baseBranch: "main",
      workingBranch: "feature/no-test"
    }));

    assert.equal(typeof payload.hasCoverageGap, "boolean");
    assert.equal(typeof payload.gapCount, "number");
    assert.equal(typeof payload.ciGate.pass, "boolean");
    assert.ok([0, 1].includes(payload.ciGate.suggestedExitCode));
    assert.ok(payload.reportJsonPath.length > 0);
    assert.ok(payload.reportMarkdownPath.length > 0);
  } finally {
    rmSync(repoPath, { recursive: true, force: true });
  }
});

test("suggest_cleanup_resources returns dry-run candidates and writes reports", async () => {
  const payload = parseFirstJson<{
    dryRun: boolean;
    thresholdDays: number;
    candidateCount: number;
    reportJson: string;
    reportMarkdown: string;
    candidates: Array<{ resourceType: string; name: string }>;
  }>(await callTool("suggest_cleanup_resources", {
    daysUnused: 30,
    limit: 30,
    resourceTypes: ["skills", "tools", "presets"],
    eventLimit: 500
  }));

  assert.equal(payload.dryRun, true);
  assert.equal(typeof payload.thresholdDays, "number");
  assert.equal(typeof payload.candidateCount, "number");
  assert.ok(Array.isArray(payload.candidates));
  const jsonPath = isAbsolute(payload.reportJson) ? payload.reportJson : resolve(process.cwd(), payload.reportJson);
  const markdownPath = isAbsolute(payload.reportMarkdown) ? payload.reportMarkdown : resolve(process.cwd(), payload.reportMarkdown);
  assert.ok(existsSync(jsonPath));
  assert.ok(existsSync(markdownPath));
});
