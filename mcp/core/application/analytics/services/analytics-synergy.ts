import type { ComboRecommendation, SynergyModel } from "../../../resource/synergy-model.js";

export function selectSynergyCandidates(input: {
  model: SynergyModel;
  agents?: string[];
  skills?: string[];
}): { agents: string[]; skills: string[] } {
  const candidateAgents = input.agents && input.agents.length > 0
    ? input.agents
    : Array.from(new Set([...input.model.pairs.values()].map((p) => p.agent)));
  const candidateSkills = input.skills && input.skills.length > 0
    ? input.skills
    : Array.from(new Set([...input.model.pairs.values()].map((p) => p.skill)));
  return {
    agents: candidateAgents,
    skills: candidateSkills
  };
}

export function buildSynergyRecommendResponse(input: {
  trainedFromTraces: number;
  pairsLearned: number;
  combos: ComboRecommendation[];
}): Record<string, unknown> {
  return {
    trainedFromTraces: input.trainedFromTraces,
    pairsLearned: input.pairsLearned,
    combos: input.combos
  };
}