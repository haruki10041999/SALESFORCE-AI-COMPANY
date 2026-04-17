import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invokeRegisteredToolForTest, listRegisteredToolNamesForTest } from "../mcp/server.js";

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
    "list_agents",
    "chat",
    "parse_and_record_chat",
    "get_agent_log",
    "get_system_events",
    "get_event_automation_config",
    "update_event_automation_config",
    "generate_kamiless_from_requirements",
    "generate_kamiless_export"
  ]) {
    assert.ok(names.includes(required), `missing tool: ${required}`);
  }
});

test("generate_kamiless_from_requirements creates kamiless spec and export from requirement text", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-company-kamiless-req-test-"));
  const specOutputPath = join(root, "auto-generated.kamiless.json");
  const exportOutputPath = join(root, "auto-generated-export.json");

  const requirementsText = [
    "フォーム名: requirements-form",
    "タイトル: 要件自動生成フォーム",
    "オブジェクト名: Applicant__c",
    "セクション: 申込者情報",
    "- 氏名 | Text | Applicant__c.Name__c | 必須",
    "- メールアドレス | Email | Applicant__c.Email__c | 必須",
    "- お問い合わせ内容 | LongTextArea | Applicant__c.Inquiry__c",
    "セクション: 同意",
    "- 利用規約に同意 | Checkbox | Applicant__c.AgreeTerms__c | 必須"
  ].join("\n");

  try {
    const result = await callTool("generate_kamiless_from_requirements", {
      requirementsText,
      specOutputPath,
      exportOutputPath,
      formName: "requirements-form"
    });

    const text = result.content[0].text;
    assert.ok(text.includes("Kamiless Spec 自動生成結果"));
    assert.ok(text.includes(specOutputPath));
    assert.ok(text.includes(exportOutputPath));

    assert.equal(existsSync(specOutputPath), true);
    assert.equal(existsSync(exportOutputPath), true);

    const spec = JSON.parse(readFileSync(specOutputPath, "utf-8")) as {
      name: string;
      title: string;
      sections: Array<{ section_label: string; fields: Array<{ field_label: string; field_type: string }> }>;
      layouts: Array<{ parts: Array<{ label: string; field_type: string; target_field?: string }> }>;
    };

    assert.equal(spec.name, "requirements-form");
    assert.equal(spec.title, "要件自動生成フォーム");
    assert.equal(spec.sections.length, 2);
    assert.equal(spec.sections[0].section_label, "申込者情報");
    assert.equal(spec.sections[1].section_label, "同意");
    assert.equal(spec.sections[0].fields[0].field_label, "氏名");
    assert.equal(spec.sections[0].fields[1].field_type, "Email");
    assert.equal(spec.layouts[0].parts[2].field_type, "textarea");
    assert.equal(spec.layouts[0].parts[3].field_type, "checkbox");

    const exported = JSON.parse(readFileSync(exportOutputPath, "utf-8")) as {
      form_layouts: Array<{ form_parts: Array<{ position: { x: number; y: number } }> }>;
      target_field_sections: Array<unknown>;
    };

    assert.equal(exported.target_field_sections.length, 2);
    assert.equal(exported.form_layouts[0].form_parts.length, 4);
    assert.equal(exported.form_layouts[0].form_parts[0].position.y, 0);
    assert.equal(exported.form_layouts[0].form_parts[3].position.y, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate_kamiless_from_requirements broadens fields from diff text", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-company-kamiless-diff-test-"));
  const specOutputPath = join(root, "diff-generated.kamiless.json");

  const requirementsText = [
    "フォーム名: diff-form",
    "タイトル: diff 取り込みフォーム",
    "セクション: 申込情報"
  ].join("\n");

  const diffText = [
    "diff --git a/sample.ts b/sample.ts",
    "+ {",
    "+   label: \"会社名\",",
    "+   field_type: \"Text\",",
    "+   object_name: \"Applicant__c\",",
    "+   field_name: \"CompanyName__c\",",
    "+   required: true",
    "+ },",
    "+ {",
    "+   label: \"生年月日\",",
    "+   field_type: \"Date\",",
    "+   object_name: \"Applicant__c\",",
    "+   field_name: \"Birthdate__c\"",
    "+ }"
  ].join("\n");

  try {
    const result = await callTool("generate_kamiless_from_requirements", {
      requirementsText,
      diffText,
      specOutputPath
    });

    const text = result.content[0].text;
    assert.ok(text.includes("diff 候補行: 2"));
    assert.equal(existsSync(specOutputPath), true);

    const spec = JSON.parse(readFileSync(specOutputPath, "utf-8")) as {
      sections: Array<{ fields: Array<{ field_label: string; field_type: string; field_name: string; required?: boolean }> }>;
      layouts: Array<{ parts: Array<{ label: string; field_type: string }> }>;
    };

    assert.equal(spec.sections.length, 1);
    assert.equal(spec.sections[0].fields.length, 2);
    assert.equal(spec.sections[0].fields[0].field_label, "会社名");
    assert.equal(spec.sections[0].fields[0].field_name, "CompanyName__c");
    assert.equal(spec.sections[0].fields[0].required, true);
    assert.equal(spec.sections[0].fields[1].field_type, "Date");
    assert.equal(spec.layouts[0].parts[1].field_type, "date");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate_kamiless_export creates export JSON with defaults", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-company-kamiless-test-"));
  const specPath = join(root, "sample.kamiless.json");
  const outputPath = join(root, "sample-export.json");

  const spec = {
    kamiless_spec_version: 1,
    name: "test-form",
    title: "Test Form",
    sections: [
      {
        key: "section-1",
        section_number: 1,
        section_label: "基本情報",
        form_layout_number: 1,
        fields: [
          {
            key: "name-field",
            field_number: 1,
            field_label: "氏名",
            field_name: "Name",
            field_type: "Text",
            object_name: "Contact"
          }
        ]
      }
    ],
    layouts: [
      {
        key: "layout-1",
        layout_number: 1,
        name: "Page 1",
        parts: [
          {
            key: "part-1",
            name: "part-001",
            label: "氏名",
            field_type: "text",
            target_field: "name-field",
            size: { width: 6, height: 1 }
          },
          {
            key: "part-2",
            name: "part-002",
            label: "備考",
            field_type: "text",
            size: { width: 6, height: 1 }
          }
        ]
      }
    ]
  };

  writeFileSync(specPath, JSON.stringify(spec, null, 2), "utf-8");

  try {
    const result = await callTool("generate_kamiless_export", {
      specPath,
      outputPath
    });

    const text = result.content[0].text;
    assert.ok(text.includes("Kamiless Export 生成結果"));
    assert.ok(text.includes(outputPath));

    assert.equal(existsSync(outputPath), true);
    const exported = JSON.parse(readFileSync(outputPath, "utf-8")) as {
      form_layouts: Array<{
        image: { path_on_client: string; width: number; height: number };
        form_parts: Array<{ position: { x: number; y: number } }>;
      }>;
    };

    assert.equal(exported.form_layouts.length, 1);
    assert.equal(exported.form_layouts[0].image.path_on_client, "default_background.png");
    assert.equal(exported.form_layouts[0].image.width, 794);
    assert.equal(exported.form_layouts[0].image.height, 1123);
    assert.equal(exported.form_layouts[0].form_parts[0].position.x, 0);
    assert.equal(exported.form_layouts[0].form_parts[0].position.y, 0);
    assert.equal(exported.form_layouts[0].form_parts[1].position.x, 0);
    assert.equal(exported.form_layouts[0].form_parts[1].position.y, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test("list_agents returns JSON array with name and summary", async () => {
  const result = await callTool("list_agents", {});
  const payload = JSON.parse(result.content[0].text) as Array<{ name: string; summary: string }>;

  assert.ok(payload.length > 0);
  assert.equal(typeof payload[0]?.name, "string");
  assert.equal(typeof payload[0]?.summary, "string");
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
