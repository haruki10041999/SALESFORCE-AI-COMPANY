export const LEARNING_EVENT_TYPES = {
  eventAppended: "learning.event.appended",
  rollbackTriggered: "learning.rollback.triggered",
  candidateRejected: "learning.candidate.rejected",
  canaryStarted: "learning.canary.started",
  promotionProposalRequested: "learning.promotion.proposal-requested",
  promoted: "learning.promoted"
} as const;

export type LearningEventType = (typeof LEARNING_EVENT_TYPES)[keyof typeof LEARNING_EVENT_TYPES];
