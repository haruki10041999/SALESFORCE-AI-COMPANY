/**
 * @deprecated Import from mcp/contexts/identity/index.js instead.
 * This file is a backward-compatibility re-export shim (TASK-14).
 */
export type {
	RbacEffect,
	RbacRule,
	RbacPolicy,
	AuthorizationResult
} from "../../contexts/identity/index.js";
export {
	loadRbacPolicy,
	authorize,
	authorizeToolExecution
} from "../../contexts/identity/index.js";
