/**
 * @deprecated Import from mcp/contexts/identity/index.js instead.
 * This file is a backward-compatibility re-export shim (TASK-14).
 */
export type {
	OidcVerifyOptions,
	OidcVerifiedIdentity
} from "../../contexts/identity/index.js";
export {
	verifyOidcToken,
	extractBearerTokenFromInput,
	resolveActorFromOidcInput
} from "../../contexts/identity/index.js";
