import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseToolSpec,
  fromLegacyCustomTool,
  DeclarativeToolSpecSchema
} from "../mcp/core/declarative/tool-spec.js";
import {
  loadDeclarativeToolsFromDir,
  buildHandler
} from "../mcp/core/declarative/loader.js";
import type { GovTool } from "../mcp/tool-types.js";

const fakeBuildPrompt = async (
  topic: string,
  agents: string[],
  persona?: string,
  skills?: string[]
) => `topic=${topic};agents=${agents.join(",")};persona=${persona ?? ""};skills=${(skills ?? []).join(",")}`;

const fakeFilter = async (skills: string[]) => ({ enabled: skills, disabled: [] });

function makeRecorder() {
  const calls: Array<{ name: string; config: unknown }> = [];
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const govTool: GovTool = (name, config, handler) => {
    calls.push({ name, config });
    handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  };
  return { calls, handlers, govTool };
}

test("Phase-Decl: legacy CustomToolDefinition is parsed into compose-prompt", () => {
  const spec = fromLegacyCustomTool({
    name: "team_review_skill",
    description: "Salesforce review",
    agents: ["architect", "qa-engineer"],
    skills: ["apex"],
    persona: "captain"
  });
  assert.equal(spec.action.kind, "compose-prompt");
  if (spec.action.kind === "compose-prompt") {
    assert.deepEqual(spec.action.agents, ["architect", "qa-engineer"]);
    assert.equal(spec.action.persona, "captain");
  }
});

test("Phase-Decl: parseToolSpec accepts new schema", () => {
  const spec = parseToolSpec({
    schemaVersion: 1,
    name: "static_faq",
    description: "FAQ",
    action: { kind: "static-text", text: "hello" }
  });
  assert.ok(spec);
  assert.equal(spec!.name, "static_faq");
  assert.equal(spec!.action.kind, "static-text");
});

test("Phase-Decl: parseToolSpec rejects garbage", () => {
  assert.equal(parseToolSpec(null), null);
  assert.equal(parseToolSpec({}), null);
  assert.equal(parseToolSpec({ name: "X-Bad", action: { kind: "static-text", text: "" } }), null);
});

test("Phase-Decl: schema enforces snake_case name", () => {
  const r = DeclarativeToolSpecSchema.safeParse({
    name: "BadName",
    description: "x",
    action: { kind: "static-text", text: "x" }
  });
  assert.equal(r.success, false);
  // dash や underscore は許容
  const okDash = DeclarativeToolSpecSchema.safeParse({
    name: "good-name",
    description: "x",
    action: { kind: "static-text", text: "x" }
  });
  assert.equal(okDash.success, true);
});

test("Phase-Decl: buildHandler static-text returns fixed text", async () => {
  const spec = parseToolSpec({
    name: "faq_x",
    description: "f",
    action: { kind: "static-text", text: "answer" }
  })!;
  const h = buildHandler(spec, { buildChatPrompt: fakeBuildPrompt, filterDisabledSkills: fakeFilter });
  const r = await h({});
  assert.equal(r.content[0].text, "answer");
});

test("Phase-Decl: buildHandler compose-prompt invokes builder", async () => {
  const spec = parseToolSpec({
    name: "compose_x",
    description: "c",
    action: { kind: "compose-prompt", agents: ["ceo"], skills: ["apex"], defaultTopic: "review" }
  })!;
  const h = buildHandler(spec, { buildChatPrompt: fakeBuildPrompt, filterDisabledSkills: fakeFilter });
  const r = await h({});
  assert.match(r.content[0].text, /topic=review/);
  assert.match(r.content[0].text, /agents=ceo/);
});

test("Phase-Decl: loadDeclarativeToolsFromDir registers valid files & skips invalid", async () => {
  const dir = mkdtempSync(join(tmpdir(), "decl-loader-"));
  try {
    writeFileSync(join(dir, "good-new.json"), JSON.stringify({
      name: "new_tool",
      description: "d",
      action: { kind: "static-text", text: "ok" }
    }));
    writeFileSync(join(dir, "good-legacy.json"), JSON.stringify({
      name: "legacy_tool",
      description: "d",
      agents: ["ceo"],
      skills: []
    }));
    writeFileSync(join(dir, "broken.json"), "{not json");
    writeFileSync(join(dir, "invalid.json"), JSON.stringify({ name: "X-Bad", description: "x" }));

    const rec = makeRecorder();
    const result = await loadDeclarativeToolsFromDir(dir, {
      govTool: rec.govTool,
      buildChatPrompt: fakeBuildPrompt,
      filterDisabledSkills: fakeFilter
    });
    assert.deepEqual(result.registered.sort(), ["legacy_tool", "new_tool"]);
    assert.equal(result.skipped.length, 2);
    assert.equal(rec.calls.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Phase-Decl: loader skips deprecated and duplicate names", async () => {
  const dir = mkdtempSync(join(tmpdir(), "decl-loader-dup-"));
  try {
    writeFileSync(join(dir, "a.json"), JSON.stringify({
      name: "shared",
      description: "d",
      action: { kind: "static-text", text: "a" }
    }));
    writeFileSync(join(dir, "b.json"), JSON.stringify({
      name: "shared",
      description: "d",
      action: { kind: "static-text", text: "b" }
    }));
    writeFileSync(join(dir, "c.json"), JSON.stringify({
      name: "deprecated_tool",
      description: "d",
      governance: { deprecated: true },
      action: { kind: "static-text", text: "x" }
    }));
    const rec = makeRecorder();
    const result = await loadDeclarativeToolsFromDir(dir, {
      govTool: rec.govTool,
      buildChatPrompt: fakeBuildPrompt,
      filterDisabledSkills: fakeFilter
    });
    assert.equal(result.registered.length, 1);
    assert.equal(result.registered[0], "shared");
    assert.ok(result.skipped.length >= 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Phase-Decl: loader returns empty for missing dir", async () => {
  const rec = makeRecorder();
  const result = await loadDeclarativeToolsFromDir("/nonexistent/path/xyz", {
    govTool: rec.govTool,
    buildChatPrompt: fakeBuildPrompt,
    filterDisabledSkills: fakeFilter
  });
  assert.equal(result.registered.length, 0);
});
