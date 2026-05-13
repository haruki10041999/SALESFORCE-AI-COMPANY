export interface PolicyEngineActor {
  id: string;
  role: string;
  tenantId?: string;
}

export interface PolicyEngineEvaluateInput {
  policySet: string;
  toolName: string;
  actor: PolicyEngineActor;
  input: unknown;
}

export interface PolicyEngineDecision {
  allowed: boolean;
  reason?: string;
  ruleId?: string;
  policySet: string;
}

export interface PolicyEngine {
  evaluate(input: PolicyEngineEvaluateInput): Promise<PolicyEngineDecision>;
}
