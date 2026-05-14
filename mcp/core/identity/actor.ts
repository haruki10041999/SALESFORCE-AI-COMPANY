/**
 * @deprecated Import from mcp/contexts/identity/index.js instead.
 * This file is a backward-compatibility re-export shim (TASK-14).
 */
export type {
	ActorType,
	ActorIdentity
} from "../../contexts/identity/index.js";
export {
	normalizeActorType,
	normalizeActorId,
	normalizeActorIdentity,
	mergeActorIdentity,
	resolveDefaultActorFromEnv,
	extractActorFromToolInput
} from "../../contexts/identity/index.js";
