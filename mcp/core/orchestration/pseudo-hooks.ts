export interface TriggerRuleLike {
  whenAgent: string;
  thenAgent: string;
  messageIncludes?: string;
  reason?: string;
  once?: boolean;
}

export function buildRuleKey(rule: TriggerRuleLike): string {
  return rule.whenAgent + "::" + rule.thenAgent + "::" + (rule.messageIncludes ?? "");
}

export function evaluatePseudoHooks(
  lastAgent: string,
  lastMessage: string,
  triggerRules: TriggerRuleLike[],
  firedRules: string[]
): { nextAgents: string[]; fired: string[]; reasons: string[] } {
  const nextAgents: string[] = [];
  const fired: string[] = [];
  const reasons: string[] = [];

  for (const rule of triggerRules) {
    if (rule.whenAgent !== lastAgent) {
      continue;
    }

    const ruleKey = buildRuleKey(rule);
    if (rule.once && firedRules.includes(ruleKey)) {
      continue;
    }

    if (rule.messageIncludes) {
      const includeWord = rule.messageIncludes.toLowerCase();
      if (!lastMessage.toLowerCase().includes(includeWord)) {
        continue;
      }
    }

    nextAgents.push(rule.thenAgent);
    fired.push(ruleKey);
    reasons.push(rule.reason ?? (rule.whenAgent + " -> " + rule.thenAgent));
  }

  return {
    nextAgents: [...new Set(nextAgents)],
    fired,
    reasons
  };
}
