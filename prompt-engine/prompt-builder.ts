import fs from "node:fs";

export type AgentProfile = {
  name: string;
  content: string;
};

export function buildPrompt(agent: AgentProfile, task: string): string {
  const base = fs.readFileSync("./prompt-engine/base-prompt.md", "utf-8");
  const reasoning = fs.readFileSync("./prompt-engine/reasoning-framework.md", "utf-8");

  return `${base}\n\nAgent\n${agent.name}\n\n${agent.content}\n\nTask\n${task}\n\n${reasoning}`;
}
