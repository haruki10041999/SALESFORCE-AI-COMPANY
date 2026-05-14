import { z } from "zod";
import type { EventSchemaRegistryMap } from "../../core/event/schema-registry.js";
import { LEARNING_EVENT_TYPES } from "./learning-event-types.js";

const learningEventAppendedV1 = z.object({
  streamId: z.string(),
  eventType: z.string(),
  version: z.number().int().min(0),
  actorId: z.string().nullable().optional(),
  payload: z.record(z.unknown()),
  schemaVersion: z.literal(1).optional()
}).passthrough();

const learningRollbackTriggeredV1 = z.object({
  from: z.string(),
  to: z.string(),
  alerts: z.array(z.string()).default([]),
  schemaVersion: z.literal(1).optional()
}).passthrough();

const learningCandidateRejectedV1 = z.object({
  candidateVersion: z.string(),
  productionVersion: z.string(),
  schemaVersion: z.literal(1).optional()
}).passthrough();

const learningCanaryStartedV1 = z.object({
  candidateVersion: z.string(),
  productionVersion: z.string(),
  trafficPercent: z.number(),
  schemaVersion: z.literal(1).optional()
}).passthrough();

const learningPromotionProposalRequestedV1 = z.object({
  candidateVersion: z.string(),
  productionVersion: z.string(),
  proposalId: z.string().nullable(),
  schemaVersion: z.literal(1).optional()
}).passthrough();

const learningPromotedV1 = z.object({
  previousVersion: z.string(),
  currentVersion: z.string(),
  candidateVersion: z.string(),
  canaryTrafficPercent: z.number(),
  schemaVersion: z.literal(1).optional()
}).passthrough();

export const DOMAIN_EVENT_SCHEMA_REGISTRY: EventSchemaRegistryMap = {
  [LEARNING_EVENT_TYPES.eventAppended]: [
    {
      version: 1,
      schema: learningEventAppendedV1
    }
  ],
  [LEARNING_EVENT_TYPES.rollbackTriggered]: [
    {
      version: 1,
      schema: learningRollbackTriggeredV1
    }
  ],
  [LEARNING_EVENT_TYPES.candidateRejected]: [
    {
      version: 1,
      schema: learningCandidateRejectedV1
    }
  ],
  [LEARNING_EVENT_TYPES.canaryStarted]: [
    {
      version: 1,
      schema: learningCanaryStartedV1
    }
  ],
  [LEARNING_EVENT_TYPES.promotionProposalRequested]: [
    {
      version: 1,
      schema: learningPromotionProposalRequestedV1
    }
  ],
  [LEARNING_EVENT_TYPES.promoted]: [
    {
      version: 1,
      schema: learningPromotedV1
    }
  ]
};
