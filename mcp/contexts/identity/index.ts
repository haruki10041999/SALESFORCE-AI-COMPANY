/**
 * Identity Bounded Context — public API barrel
 *
 * This is the ONLY file that should be imported by other bounded contexts
 * when they need identity primitives.
 *
 * Internal modules (actor.ts, actor-context.ts, etc.) must not be imported
 * directly from outside this context.
 */

export type { ActorType, ActorIdentity } from "./actor.js";
export {
  normalizeActorType,
  normalizeActorId,
  normalizeActorIdentity,
  mergeActorIdentity,
  resolveDefaultActorFromEnv,
  extractActorFromToolInput,
} from "./actor.js";

export {
  runWithActorContext,
  getCurrentActor,
  getCurrentActorOrDefault,
  currentActor,
} from "./actor-context.js";

export {
  currentTenantId,
  isTenantScoped,
  runWithTenantContext,
} from "./tenant-context.js";

export type { RbacEffect, RbacRule, RbacPolicy, AuthorizationResult } from "./rbac.js";
export { loadRbacPolicy, authorize, authorizeToolExecution } from "./rbac.js";

export type { OidcVerifyOptions, OidcVerifiedIdentity } from "./oidc-verifier.js";
export {
  verifyOidcToken,
  extractBearerTokenFromInput,
  resolveActorFromOidcInput,
} from "./oidc-verifier.js";
