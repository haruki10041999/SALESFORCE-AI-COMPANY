import { rankSkillNamesByTopic } from "../resource/topic-skill-ranking.js";
import {
  startTrace,
  endTrace,
  failTrace,
  withPhase
} from "../trace/trace-context.js";

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
    // TASK-038: phase 分解で input/plan/execute/render の各 duration を計測
    const traceId = startTrace("chat", {
      agent: input.agents?.[0],
      skills: input.skills,
      topic: input.topic
    });
    try {
      const { effectiveSkills, autoSkills, requestedSkills } = await withPhase(
        traceId,
        "input",
        async () => {
          const requested = input.skills ?? [];
          const auto = requested.length === 0
            ? await suggestSkillsFromTopic(input.topic, deps.listSkills, autoSkillLimit)
            : [];
          return {
            requestedSkills: requested,
            autoSkills: auto,
            effectiveSkills: requested.length > 0 ? requested : auto
          };
        }
      );

      const enabledSkills = await withPhase(traceId, "plan", async () => {
        const filtered = await deps.filterDisabledSkills(effectiveSkills);
        if (requestedSkills.length === 0 && autoSkills.length === 0) {
          await deps.emitSystemEvent("low_relevance_detected", {
            source: "chat:auto-skill-selection",
            topic: input.topic,
            reason: "no skills selected from topic"
          });
        }
        return filtered.enabled;
      });

      const prompt = await withPhase(traceId, "execute", async () =>
        deps.buildChatPrompt(
          input.topic,
          input.agents ?? [],
          input.persona,
          enabledSkills,
          input.filePaths ?? [],
          input.turns ?? 6,
          input.maxContextChars,
          input.appendInstruction
        )
      );

      const response = await withPhase(traceId, "render", async () => ({
        content: [
          {
            type: "text" as const,
            text: prompt
          }
        ]
      }));

      endTrace(traceId, { skillCount: enabledSkills.length });
      return response;
    } catch (err) {
      failTrace(traceId, err);
      throw err;
    }
  };
}
