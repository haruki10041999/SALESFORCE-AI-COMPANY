/**
 * Dangerous Action Catalog
 *
 * Defines actions that are considered irreversible or high-risk.
 * Every listed action requires explicit admin approval via the proposal queue
 * before execution is permitted.
 *
 * Format per entry:
 *   toolName     : MCP tool identifier
 *   actionType   : semantic category
 *   riskLevel    : "high" | "critical"
 *   description  : human-readable reason why it's dangerous
 *   requiresApproval : when true, PolicyGate will block direct execution
 *   requiredRole : minimum role needed (checked after approval)
 */

export type DangerousActionRisk = "high" | "critical";

export interface DangerousActionEntry {
  toolName: string;
  actionType: string;
  riskLevel: DangerousActionRisk;
  description: string;
  requiresApproval: boolean;
  requiredRole?: string;
}

/**
 * The canonical list of dangerous tool invocations.
 * Match is performed against `toolName` (exact) and optionally `actionType`
 * which can be derived from the input payload by the policy gate.
 */
export const DANGEROUS_ACTIONS: DangerousActionEntry[] = [
  // --- Memory & Knowledge ---
  {
    toolName: "clear_memory",
    actionType: "wipe",
    riskLevel: "critical",
    description: "Erases all project memory — irreversible without a backup.",
    requiresApproval: true
  },
  // --- Resource governance ---
  {
    toolName: "apply_resource_actions",
    actionType: "delete",
    riskLevel: "high",
    description: "Bulk-delete of governed resources (skills/tools/presets).",
    requiresApproval: true
  },
  {
    toolName: "apply_resource_actions",
    actionType: "disable_all",
    riskLevel: "critical",
    description: "Disable all tools simultaneously — shuts down all AI capabilities.",
    requiresApproval: true
  },
  // --- Org management ---
  {
    toolName: "remove_org",
    actionType: "delete",
    riskLevel: "critical",
    description: "Permanently remove an org record and all associated data.",
    requiresApproval: true
  },
  {
    toolName: "deploy_org",
    actionType: "deploy",
    riskLevel: "high",
    description: "Deploy metadata to a production Salesforce org.",
    requiresApproval: true,
    requiredRole: "release-manager"
  },
  // --- Sessions ---
  {
    toolName: "list_orchestration_sessions",
    actionType: "read",
    riskLevel: "high",
    description: "Lists all active orchestration sessions — potential PII exposure.",
    requiresApproval: false,
    requiredRole: "admin"
  }
];

/**
 * Look up the catalog entry for a given tool + optional action type.
 * Returns `undefined` if the action is not dangerous.
 */
export function lookupDangerousAction(
  toolName: string,
  actionType?: string
): DangerousActionEntry | undefined {
  return DANGEROUS_ACTIONS.find((entry) => {
    if (entry.toolName !== toolName) return false;
    if (actionType && entry.actionType !== actionType) return false;
    return true;
  });
}

/**
 * Check whether a tool call requires approval.
 * Returns the matching catalog entry if approval is needed, undefined otherwise.
 */
export function requiresApproval(
  toolName: string,
  actionType?: string
): DangerousActionEntry | undefined {
  const entry = lookupDangerousAction(toolName, actionType);
  return entry?.requiresApproval ? entry : undefined;
}
