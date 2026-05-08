import assert from "node:assert/strict";
import test from "node:test";
import {
  extractActorFromToolInput,
  mergeActorIdentity,
  normalizeActorIdentity,
  resolveDefaultActorFromEnv,
  type ActorIdentity
} from "../mcp/core/identity/actor.js";
import { currentActor, runWithActorContext } from "../mcp/core/identity/actor-context.js";

test("resolveDefaultActorFromEnv resolves valid actor identity", () => {
  const actor = resolveDefaultActorFromEnv({
    SF_AI_ACTOR_TYPE: "user",
    SF_AI_ACTOR_ID: "u-100",
    SF_AI_ROLE: "operator",
    SF_AI_TENANT_ID: "tenant-a"
  } as NodeJS.ProcessEnv);

  assert.equal(actor.type, "user");
  assert.equal(actor.id, "u-100");
  assert.equal(actor.role, "operator");
  assert.equal(actor.tenantId, "tenant-a");
});

test("extractActorFromToolInput reads actor override", () => {
  const extracted = extractActorFromToolInput({
    actor: {
      type: "agent",
      id: "agent-01",
      role: "reviewer",
      tenantId: "tenant-z"
    }
  });

  assert.ok(extracted);
  assert.equal(extracted?.type, "agent");
  assert.equal(extracted?.id, "agent-01");
  assert.equal(extracted?.role, "reviewer");
  assert.equal(extracted?.tenantId, "tenant-z");
});

test("runWithActorContext makes actor available through currentActor", async () => {
  const base: ActorIdentity = normalizeActorIdentity({
    type: "service_account",
    id: "svc-runtime",
    role: "admin"
  });

  const merged = mergeActorIdentity(base, {
    type: "user",
    id: "user-77"
  });

  await runWithActorContext(merged, async () => {
    const actor = currentActor();
    assert.equal(actor.type, "user");
    assert.equal(actor.id, "user-77");
    assert.equal(actor.role, "admin");
  });
});
