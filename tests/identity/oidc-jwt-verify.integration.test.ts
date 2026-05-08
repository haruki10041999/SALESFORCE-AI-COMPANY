import assert from "node:assert/strict";
import test from "node:test";
import { resolveActorFromOidcInput } from "../../mcp/core/identity/oidc-verifier.js";

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64url");
}

function makeUnsignedJwt(payload: Record<string, unknown>): string {
  const header = { alg: "none", typ: "JWT" };
  return `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(JSON.stringify(payload))}.`;
}

test("resolveActorFromOidcInput maps JWT claims to actor in jwt mode", async () => {
  const token = makeUnsignedJwt({
    iss: "https://issuer.example.com",
    aud: "sf-ai",
    sub: "user-123",
    role: "reviewer",
    tenant_id: "tenant-a",
    name: "User A",
    exp: Math.floor(Date.now() / 1000) + 120
  });

  const actor = await resolveActorFromOidcInput(
    { authorization: `Bearer ${token}` },
    {
      SF_AI_AUTH_MODE: "jwt",
      SF_AI_OIDC_ISSUER: "https://issuer.example.com",
      SF_AI_OIDC_AUDIENCE: "sf-ai",
      SF_AI_OIDC_ALLOW_INSECURE_UNSIGNED: "true"
    } as NodeJS.ProcessEnv
  );

  assert.ok(actor);
  assert.equal(actor?.id, "user-123");
  assert.equal(actor?.role, "reviewer");
  assert.equal(actor?.tenantId, "tenant-a");
  assert.equal(actor?.displayName, "User A");
});

test("resolveActorFromOidcInput throws when jwt mode has no token", async () => {
  await assert.rejects(async () => {
    await resolveActorFromOidcInput(
      {},
      {
        SF_AI_AUTH_MODE: "jwt",
        SF_AI_OIDC_ALLOW_INSECURE_UNSIGNED: "true"
      } as NodeJS.ProcessEnv
    );
  });
});

test("resolveActorFromOidcInput is noop when auth mode disabled", async () => {
  const actor = await resolveActorFromOidcInput(
    {},
    {
      SF_AI_AUTH_MODE: "disabled"
    } as NodeJS.ProcessEnv
  );

  assert.equal(actor, undefined);
});
