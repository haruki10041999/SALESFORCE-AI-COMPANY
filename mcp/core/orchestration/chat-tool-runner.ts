import { rankSkillNamesByTopic } from "../resource/topic-skill-ranking.js";

export interface ChatToolInput {
  topic: string;
  filePaths?: string[];
  agents?: string[];
  persona?: string;
  skills?: string[];
  turns?: number;
  maxContextChars?: number;
  appendInstruction?: string;
}

interface CreateChatToolRunnerDeps {
  listSkills: () => { name: string; summary: string }[];
  filterDisabledSkills: (skillNames: string[]) => Promise<{ enabled: string[]; disabled: string[] }>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  buildChatPrompt: (
    topic: string,
    agentNames: string[],
    personaName: string | undefined,
    skillNames: string[],
    filePaths: string[],
    turns: number,
    maxContextChars?: number,
    appendInstruction?: string,
    includeProjectContext?: boolean
  ) => Promise<string>;
  autoSkillLimit?: number;
}

async function suggestSkillsFromTopic(
  topic: string,
  listSkills: () => { name: string; summary: string }[],
  limit: number
): Promise<string[]> {
  const skills = listSkills();
  return rankSkillNamesByTopic(topic, skills, limit);
}

export function generateSessionId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `orch-${ts}`;
}

export function createChatToolRunner(deps: CreateChatToolRunnerDeps): (input: ChatToolInput) => Promise<{
  content: Array<{ type: "text"; text: string }>;
}> {
  const autoSkillLimit = deps.autoSkillLimit ?? 3;

  return async function runChatTool(input: ChatToolInput): Promise<{
    content: Array<{ type: "text"; text: string }>;
  }> {
    const requestedSkills = input.skills ?? [];
    const autoSkills = requestedSkills.length === 0
      ? await suggestSkillsFromTopic(input.topic, deps.listSkills, autoSkillLimit)
      : [];
    const effectiveSkills = requestedSkills.length > 0 ? requestedSkills : autoSkills;
    const { enabled: enabledSkills } = await deps.filterDisabledSkills(effectiveSkills);

    if (requestedSkills.length === 0 && autoSkills.length === 0) {
      await deps.emitSystemEvent("low_relevance_detected", {
        source: "chat:auto-skill-selection",
        topic: input.topic,
        reason: "no skills selected from topic"
      });
    }

    const prompt = await deps.buildChatPrompt(
      input.topic,
      input.agents ?? [],
      input.persona,
      enabledSkills,
      input.filePaths ?? [],
      input.turns ?? 6,
      input.maxContextChars,
      input.appendInstruction
    );

    return {
      content: [
        {
          type: "text",
          text: prompt
        }
      ]
    };
  };
}
