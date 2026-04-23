/**
 * Trigger rule for orchestration workflows
 */
export interface TriggerRule {
  whenAgent: string;
  thenAgent: string;
  messageIncludes?: string;
  reason?: string;
  once?: boolean;
}
