import { DEFAULT_SCORING_CONFIG, scoreCandidate, type ResourceCandidate } from "./resource-selector.js";

export interface NamedSummary {
  name: string;
  summary: string;
}

export function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/[\s_\-\/]+/g, " ").trim();
}

export function tokenizeQuery(query: string): string[] {
  return normalizeForSearch(query)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function scoreByQuery(query: string, ...targets: string[]): number {
  if (!query.trim()) return 0;

  const candidate: ResourceCandidate = {
    name: targets[0] ?? "",
    description: targets.slice(1).filter(Boolean).join(" "),
    tags: tokenizeQuery(targets.join(" ")),
    usage: 0,
    bugSignals: 0
  };

  return scoreCandidate(candidate, query, DEFAULT_SCORING_CONFIG);
}

export function rankSkillNamesByTopic(topic: string, skills: NamedSummary[], limit = 3): string[] {
  return skills
    .map((s) => ({
      name: s.name,
      score: scoreByQuery(topic, s.name, s.summary)
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.name);
}
