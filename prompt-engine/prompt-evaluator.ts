export interface PromptMetrics {
  lengthChars: number;
  lineCount: number;
  estimatedTokens: number;
  containsProjectContext: boolean;
  containsAgentsSection: boolean;
  containsSkillsSection: boolean;
  containsTaskSection: boolean;
  matchedSkillCount: number;
  totalSkillCount: number;
  matchedTriggerCount: number;
  totalTriggerCount: number;
  skillCoverageRate: number;
  triggerMatchRate: number;
}

export function evaluatePromptMetrics(
  prompt: string,
  skills: string[] = [],
  triggerKeywords: string[] = []
): PromptMetrics {
  const normalizedPrompt = prompt.toLowerCase();
  const lengthChars = prompt.length;
  const lineCount = prompt.split(/\r?\n/).length;

  const matchedSkills = skills.filter((skill) => normalizedPrompt.includes(skill.toLowerCase()));
  const matchedTriggers = triggerKeywords.filter((keyword) => normalizedPrompt.includes(keyword.toLowerCase()));

  return {
    lengthChars,
    lineCount,
    estimatedTokens: Math.ceil(lengthChars / 4),
    containsProjectContext: normalizedPrompt.includes("プロジェクトコンテキスト") || normalizedPrompt.includes("project context"),
    containsAgentsSection: normalizedPrompt.includes("参加エージェント") || normalizedPrompt.includes("agents"),
    containsSkillsSection: normalizedPrompt.includes("適用スキル") || normalizedPrompt.includes("skills"),
    containsTaskSection: normalizedPrompt.includes("タスク") || normalizedPrompt.includes("task"),
    matchedSkillCount: matchedSkills.length,
    totalSkillCount: skills.length,
    matchedTriggerCount: matchedTriggers.length,
    totalTriggerCount: triggerKeywords.length,
    skillCoverageRate: skills.length === 0 ? 1 : matchedSkills.length / skills.length,
    triggerMatchRate: triggerKeywords.length === 0 ? 1 : matchedTriggers.length / triggerKeywords.length
  };
}
