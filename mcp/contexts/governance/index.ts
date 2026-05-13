/**
 * Governance Bounded Context — public API barrel (scaffolded)
 *
 * Status: scaffolded — files still reside in mcp/core/governance/.
 * Physical migration is tracked in TASK-14 (subsequent increments).
 *
 * New code should import from this barrel rather than mcp/core/governance/ directly.
 */

// Re-export from current location until physical migration is complete
export * from "../../core/governance/governed-tool-registrar.js";
export * from "../../core/governance/governance-state-manager.js";
export * from "../../core/governance/rbac-policy.js";
export * from "../../core/governance/execution-policy.js";
export * from "../../core/governance/dangerous-actions.js";
export * from "../../core/governance/policy-gate.js";
