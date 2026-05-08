export type ActorType = "user" | "service_account" | "agent" | "system";

export interface ActorIdentity {
  type: ActorType;
  id: string;
  displayName?: string;
  role?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
}

const VALID_TYPES: ActorType[] = ["user", "service_account", "agent", "system"];

export function normalizeActorType(value: string | undefined): ActorType {
  if (!value) return "system";
  const normalized = value.trim().toLowerCase();
  return (VALID_TYPES as string[]).includes(normalized) ? (normalized as ActorType) : "system";
}

export function normalizeActorId(value: string | undefined, fallbackType: ActorType): string {
  const v = value?.trim();
  if (v && v.length > 0) return v;
  if (fallbackType === "system") return "system";
  return "unknown";
}

export function normalizeActorIdentity(input: Partial<ActorIdentity> | undefined): ActorIdentity {
  const type = normalizeActorType(input?.type);
  return {
    type,
    id: normalizeActorId(input?.id, type),
    displayName: input?.displayName,
    role: input?.role,
    tenantId: input?.tenantId,
    metadata: input?.metadata
  };
}

export function mergeActorIdentity(base: ActorIdentity, override?: Partial<ActorIdentity>): ActorIdentity {
  if (!override) return base;
  return normalizeActorIdentity({
    ...base,
    ...override,
    metadata: {
      ...(base.metadata ?? {}),
      ...(override.metadata ?? {})
    }
  });
}

/**
 * Resolve the process default actor from environment variables.
 *
 * - SF_AI_ACTOR_TYPE: user | service_account | agent | system
 * - SF_AI_ACTOR_ID:   actor id
 * - SF_AI_ROLE:       optional RBAC role
 * - SF_AI_TENANT_ID:  optional tenant id
 */
export function resolveDefaultActorFromEnv(env: NodeJS.ProcessEnv = process.env): ActorIdentity {
  const type = normalizeActorType(env.SF_AI_ACTOR_TYPE);
  return {
    type,
    id: normalizeActorId(env.SF_AI_ACTOR_ID, type),
    role: env.SF_AI_ROLE,
    tenantId: env.SF_AI_TENANT_ID,
    metadata: {
      source: "env"
    }
  };
}

/**
 * Best-effort extraction from tool input payload.
 * Accepts shape: { actor: { type, id, role, tenantId, displayName, metadata } }
 */
export function extractActorFromToolInput(input: unknown): Partial<ActorIdentity> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const actor = record.actor;
  if (!actor || typeof actor !== "object") return undefined;
  const a = actor as Record<string, unknown>;
  const result: Partial<ActorIdentity> = {
    type: typeof a.type === "string" ? normalizeActorType(a.type) : undefined,
    id: typeof a.id === "string" ? a.id : undefined,
    role: typeof a.role === "string" ? a.role : undefined,
    tenantId: typeof a.tenantId === "string" ? a.tenantId : undefined,
    displayName: typeof a.displayName === "string" ? a.displayName : undefined,
    metadata: a.metadata && typeof a.metadata === "object" ? (a.metadata as Record<string, unknown>) : undefined
  };
  if (!result.type && !result.id && !result.role && !result.tenantId && !result.displayName && !result.metadata) {
    return undefined;
  }
  return result;
}
