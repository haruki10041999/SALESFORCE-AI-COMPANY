import { z } from "zod";

/**
 * Chat input schema for orchestration and chat tools
 * Defines the shape and validation rules for chat requests
 */
export const chatInputSchema = {
  topic: z.string(),
  filePaths: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  persona: z.string().optional(),
  skills: z.array(z.string()).optional(),
  turns: z.number().int().min(1).max(30).optional(),
  maxContextChars: z.number().int().min(500).max(200000).optional(),
  appendInstruction: z.string().optional()
};

/**
 * Trigger rule schema for orchestration workflows
 * Defines conditional routing rules between agents
 */
export const triggerRuleSchema = z.object({
  whenAgent: z.string(),
  thenAgent: z.string(),
  messageIncludes: z.string().optional(),
  reason: z.string().optional(),
  once: z.boolean().optional()
});

/**
 * Inferred type from triggerRuleSchema for TypeScript type checking
 */
export type TriggerRule = z.infer<typeof triggerRuleSchema>;
