import type { ProposalRecord } from "../resource/proposal/queue.js";

export type ProposalRiskLevel = "low" | "medium" | "high";

export interface ProposalApprovalPolicy {
  timeoutHours: number;
  autoApprovalEnabled: boolean;
  lowRiskOnly: boolean;
  escalationTargets: string[];
}

export interface ProposalEscalationNotice {
  proposalId: string;
  resourceType: ProposalRecord["resourceType"];
  name: string;
  ageHours: number;
  timeoutHours: number;
  riskLevel?: ProposalRiskLevel;
  escalationTargets: string[];
  reason: string;
}

function parseContentRiskLevel(record: ProposalRecord): ProposalRiskLevel | undefined {
  try {
    const parsed = JSON.parse(record.content) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    const riskLevel = (parsed as Record<string, unknown>).riskLevel;
    if (riskLevel === "low" || riskLevel === "medium" || riskLevel === "high") {
      return riskLevel;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function getProposalRiskLevel(record: ProposalRecord): ProposalRiskLevel | undefined {
  return parseContentRiskLevel(record);
}

export function getProposalAgeHours(record: ProposalRecord, now: Date = new Date()): number {
  const createdAtMs = Date.parse(record.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return 0;
  }
  const ageMs = Math.max(0, now.getTime() - createdAtMs);
  return ageMs / (60 * 60 * 1000);
}

export function isProposalPastApprovalTimeout(
  record: ProposalRecord,
  policy: ProposalApprovalPolicy,
  now: Date = new Date()
): boolean {
  return getProposalAgeHours(record, now) >= policy.timeoutHours;
}

export function shouldAutoApproveProposal(
  record: ProposalRecord,
  policy: ProposalApprovalPolicy,
  now: Date = new Date()
): boolean {
  if (!policy.autoApprovalEnabled || !isProposalPastApprovalTimeout(record, policy, now)) {
    return false;
  }
  if (!policy.lowRiskOnly) {
    return true;
  }
  return getProposalRiskLevel(record) === "low";
}

export function buildProposalEscalationNotice(
  record: ProposalRecord,
  policy: ProposalApprovalPolicy,
  now: Date = new Date()
): ProposalEscalationNotice {
  const ageHours = getProposalAgeHours(record, now);
  const riskLevel = getProposalRiskLevel(record);
  return {
    proposalId: record.id,
    resourceType: record.resourceType,
    name: record.name,
    ageHours: Number(ageHours.toFixed(2)),
    timeoutHours: policy.timeoutHours,
    riskLevel,
    escalationTargets: [...policy.escalationTargets],
    reason: `proposal has been pending for ${ageHours.toFixed(1)}h and requires human review`
  };
}