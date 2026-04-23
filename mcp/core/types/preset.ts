import type { TriggerRule } from "./trigger-rule.js";

/**
 * Chat preset input (from API)
 */
export interface ChatPreset {
  name: string;
  description: string;
  topic: string;
  agents: string[];
  skills?: string[];
  persona?: string;
  filePaths?: string[];
  triggerRules?: TriggerRule[];
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Chat preset stored in catalog
 */
export interface StoredPreset extends ChatPreset {
  skills: string[];
}
