import test from "node:test";
import assert from "node:assert/strict";
import {
  AesGcmAtRestCrypto,
  EnvKeyProvider,
  buildAtRestCryptoConfigFromEnv,
  createAtRestCryptoFromEnv,
  parseEncryptedEnvelope,
  serializeEncryptedEnvelope
} from "../../mcp/core/security/at-rest-crypto.js";

const TEST_KEY_B64 = Buffer.from("0123456789abcdef0123456789abcdef", "utf-8").toString("base64");

test("aes-gcm at-rest crypto can roundtrip utf8 text", () => {
  const provider = new EnvKeyProvider({
    SF_AI_ENCRYPTION_KEY_B64: TEST_KEY_B64,
    SF_AI_ENCRYPTION_KEY_ID: "test-v1"
  });
  const crypto = new AesGcmAtRestCrypto(provider);

  const plainText = "sensitive payload 日本語";
  const encrypted = crypto.encryptUtf8(plainText);
  const serialized = serializeEncryptedEnvelope(encrypted);
  const parsed = parseEncryptedEnvelope(serialized);
  const restored = crypto.decryptUtf8(parsed);

  assert.equal(restored, plainText);
  assert.equal(parsed.keyId, "test-v1");
});

test("at-rest crypto fails with unknown key id", () => {
  const provider = new EnvKeyProvider({
    SF_AI_ENCRYPTION_KEY_B64: TEST_KEY_B64,
    SF_AI_ENCRYPTION_KEY_ID: "key-a"
  });
  const crypto = new AesGcmAtRestCrypto(provider);
  const encrypted = crypto.encryptUtf8("hello");

  const tampered = {
    ...encrypted,
    keyId: "key-b"
  };

  assert.throws(() => crypto.decryptUtf8(tampered), /Unknown key id/);
});

test("at-rest crypto config reads env and can disable factory", () => {
  const disabled = buildAtRestCryptoConfigFromEnv({
    SF_AI_ENCRYPTION_ENABLED: "false"
  });
  assert.equal(disabled.enabled, false);
  assert.equal(createAtRestCryptoFromEnv({ SF_AI_ENCRYPTION_ENABLED: "false" }), null);

  const enabled = buildAtRestCryptoConfigFromEnv({
    SF_AI_ENCRYPTION_ENABLED: "true",
    SF_AI_ENCRYPTION_KEY_ID: "key-z"
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.keyId, "key-z");
});
