/**
 * Policy Gate — enforces the Dangerous Action Catalog at tool execution time.
 *
 * Integration pattern:
 *   Before executing any tool, call `policyGate.check(toolName, input)`.
 *   If the result is `{ blocked: true }`, return the required proposal info
 *   to the caller instead of executing the tool.
 *
 * The gate:
 *   1. Looks up the tool in DANGEROUS_ACTIONS
 *   2. If requiresApproval=true → creates/references a pending proposal and
 *      blocks execution with a structured error response
 *   3. Writes a BLOCKED audit entry
 *
 * It is designed to be injected into `governed-tool-registrar.ts` so every
 * govTool call passes through the gate automatically.
 */

import { lookupDangerousAction, requiresApproval, type DangerousActionEntry } from "./dangerous-actions.js";

export interface PolicyGateOptions {
  /** Called when a dangerous action is blocked to persist an audit event. */
  onBlocked?: (toolName: string, entry: DangerousActionEntry, input: unknown) => Promise<void>;
}

export type PolicyCheckResult =
  | { blocked: false }
  | {
      blocked: true;
      entry: DangerousActionEntry;
      /** Human-readable message for the MCP caller */
      message: string;
      /** The tool to call to create a proposal for this action */
      requiredAction: "enqueue_proposal";
      proposalHint: {
        resourceType: string;
        name: string;
        content: string;
      };
    };

export interface PolicyGate {
  check(toolName: string, input: unknown): Promise<PolicyCheckResult>;
  isDangerous(toolName: string, actionType?: string): boolean;
}

/**
 * Extract an action type hint from the tool input (best-effort).
 * Tools like `apply_resource_actions` have an `actions` array with a `type` field.
 */
function extractActionType(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const inp = input as Record<string, unknown>;
  // apply_resource_actions: { actions: [{ type: "delete"|"disable"|... }] }
  if (Array.isArray(inp["actions"])) {
    const types = (inp["actions"] as Array<Record<string, unknown>>)
      .map((a) => typeof a["type"] === "string" ? a["type"] : undefined)
      .filter((t): t is string => Boolean(t));
    if (types.includes("disable") && types.length === (inp["actions"] as unknown[]).length) {
      return "disable_all";
    }
    if (types.includes("delete")) return "delete";
    return types[0];
  }
  if (typeof inp["action"] === "string") return inp["action"];
  return undefined;
}

export function createPolicyGate(options: PolicyGateOptions = {}): PolicyGate {
  return {
    isDangerous(toolName: string, actionType?: string): boolean {
      return lookupDangerousAction(toolName, actionType) !== undefined;
    },

    async check(toolName: string, input: unknown): Promise<PolicyCheckResult> {
      const actionType = extractActionType(input);
      const entry = requiresApproval(toolName, actionType)
        ?? requiresApproval(toolName);   // fallback: check without actionType

      if (!entry) {
        return { blocked: false };
      }

      if (options.onBlocked) {
        await options.onBlocked(toolName, entry, input).catch(() => {
          // never let audit failure block the gate response
        });
      }

      return {
        blocked: true,
        entry,
        message:
          `[Policy Gate] Tool \`${toolName}\` (action: ${entry.actionType}) is classified as ` +
          `${entry.riskLevel.toUpperCase()} risk and requires admin approval before execution.\n` +
          `Reason: ${entry.description}\n` +
          `To proceed, call \`enqueue_proposal\` with the details below, then wait for approval.`,
        requiredAction: "enqueue_proposal",
        proposalHint: {
          resourceType: "governance",
          name: `dangerous-action-approval:${toolName}:${entry.actionType}`,
          content: JSON.stringify({
            toolName,
            actionType: entry.actionType,
            riskLevel: entry.riskLevel,
            requestedAt: new Date().toISOString(),
            inputSnapshot:
              typeof input === "object"
                ? JSON.stringify(input).slice(0, 500)
                : String(input).slice(0, 200)
          })
        }
      };
    }
  };
}

/**
 * Build the MCP tool response content for a blocked action.
 */
export function buildBlockedResponse(result: Extract<PolicyCheckResult, { blocked: true }>): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            blocked: true,
            riskLevel: result.entry.riskLevel,
            message: result.message,
            requiredAction: result.requiredAction,
            proposalHint: result.proposalHint
          },
          null,
          2
        )
      }
    ]
  };
}
