import assert from "node:assert/strict";
import test from "node:test";
import { defineSmartChatTool } from "../mcp/handlers/lightweight/smart-chat.js";

test("smart_chat prefers governance agents for compliance topics", async () => {
  const handlers = new Map<string, (input: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>>();
  let capturedAgents: string[] | null = null;

  defineSmartChatTool({
    govTool: (name, _config, handler) => {
      handlers.set(name, handler as (input: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>);
    },
    root: "d:/Projects/mult-agent-ai/salesforce-ai-company",
    filterDisabledSkills: async (skillNames) => ({ enabled: skillNames, disabled: [] }),
    buildChatPrompt: async (_topic, agents) => {
      capturedAgents = agents;
      return "prompt";
    }
  });

  const handler = handlers.get("smart_chat");
  assert.ok(handler);

  const result = await handler!({
    topic: "security budget and compliance review",
    agents: ["qa-engineer", "security-engineer", "product-manager"],
    skills: []
  });

  assert.equal(result.content[0].type, "text");
  assert.ok(capturedAgents);
  assert.equal(capturedAgents![0], "security-engineer");
  assert.match(result.content[0].text, /推定カテゴリ: governance-compliance/);
});
