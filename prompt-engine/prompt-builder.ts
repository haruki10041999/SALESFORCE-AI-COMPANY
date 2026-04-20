import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type AgentProfile = {
  name: string;
  content: string;
};

export function buildPrompt(agent: AgentProfile, task: string): string {
  const base = fs.readFileSync(join(__dirname, "base-prompt.md"), "utf-8");
  const reasoning = fs.readFileSync(join(__dirname, "reasoning-framework.md"), "utf-8");

  return `${base}\n\nAgent\n${agent.name}\n\n${agent.content}\n\nTask\n${task}\n\n${reasoning}`;
}
