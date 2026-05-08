import { currentActor, runWithActorContext } from "./actor-context.js";

/**
 * Returns the current tenant id from actor context.
 */
export function currentTenantId(): string | undefined {
  return currentActor().tenantId;
}

/**
 * Returns true when request execution is tenant-scoped.
 */
export function isTenantScoped(): boolean {
  return Boolean(currentTenantId());
}

/**
 * Runs a function with the same actor context but overridden tenant id.
 */
export function runWithTenantContext<T>(tenantId: string | undefined, fn: () => T): T {
  const actor = currentActor();
  return runWithActorContext({ ...actor, tenantId }, fn);
}
