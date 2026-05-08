import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { isEnvFlagEnabled } from "../config/env-flags.js";

export const AT_REST_ALGORITHM = "aes-256-gcm" as const;
export const ENCRYPTION_ENVELOPE_VERSION = 1 as const;
const IV_LENGTH_BYTES = 12;
const REQUIRED_KEY_BYTES = 32;

export interface EncryptionKeyMaterial {
  keyId: string;
  key: Buffer;
}

export interface KeyProvider {
  getActiveKey(): EncryptionKeyMaterial;
  getKeyById(keyId: string): EncryptionKeyMaterial | null;
}

export interface EncryptedEnvelope {
  version: number;
  alg: typeof AT_REST_ALGORITHM;
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface AtRestCrypto {
  encryptUtf8(plainText: string): EncryptedEnvelope;
  decryptUtf8(envelope: EncryptedEnvelope): string;
}

export class EnvKeyProvider implements KeyProvider {
  private readonly material: EncryptionKeyMaterial;

  public constructor(env: NodeJS.ProcessEnv = process.env) {
    const keyB64 = env.SF_AI_ENCRYPTION_KEY_B64;
    if (!keyB64 || keyB64.trim().length === 0) {
      const hint = env.SF_AI_ENCRYPTION_KEY_SECRET_NAME
        ? " (set SF_AI_SECRET_BACKEND and enable env-loader secret hydration)"
        : "";
      throw new Error(`Missing required env: SF_AI_ENCRYPTION_KEY_B64${hint}`);
    }
    const decoded = Buffer.from(keyB64, "base64");
    if (decoded.length !== REQUIRED_KEY_BYTES) {
      throw new Error("SF_AI_ENCRYPTION_KEY_B64 must decode to exactly 32 bytes");
    }
    this.material = {
      keyId: env.SF_AI_ENCRYPTION_KEY_ID?.trim() || "local-env-v1",
      key: decoded
    };
  }

  public getActiveKey(): EncryptionKeyMaterial {
    return this.material;
  }

  public getKeyById(keyId: string): EncryptionKeyMaterial | null {
    return keyId === this.material.keyId ? this.material : null;
  }
}

export class AesGcmAtRestCrypto implements AtRestCrypto {
  public constructor(private readonly keyProvider: KeyProvider) {}

  public encryptUtf8(plainText: string): EncryptedEnvelope {
    const keyMaterial = this.keyProvider.getActiveKey();
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(AT_REST_ALGORITHM, keyMaterial.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      version: ENCRYPTION_ENVELOPE_VERSION,
      alg: AT_REST_ALGORITHM,
      keyId: keyMaterial.keyId,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: encrypted.toString("base64")
    };
  }

  public decryptUtf8(envelope: EncryptedEnvelope): string {
    if (envelope.alg !== AT_REST_ALGORITHM) {
      throw new Error(`Unsupported encryption algorithm: ${envelope.alg}`);
    }
    const keyMaterial = this.keyProvider.getKeyById(envelope.keyId);
    if (!keyMaterial) {
      throw new Error(`Unknown key id: ${envelope.keyId}`);
    }

    const iv = Buffer.from(envelope.iv, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");

    const decipher = createDecipheriv(AT_REST_ALGORITHM, keyMaterial.key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf-8");
  }
}

export interface AtRestCryptoConfig {
  enabled: boolean;
  keyId: string;
}

export function buildAtRestCryptoConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AtRestCryptoConfig {
  return {
    enabled: isEnvFlagEnabled("SF_AI_ENCRYPTION_ENABLED", env, false),
    keyId: env.SF_AI_ENCRYPTION_KEY_ID?.trim() || "local-env-v1"
  };
}

export function createAtRestCryptoFromEnv(env: NodeJS.ProcessEnv = process.env): AtRestCrypto | null {
  const config = buildAtRestCryptoConfigFromEnv(env);
  if (!config.enabled) {
    return null;
  }
  return new AesGcmAtRestCrypto(new EnvKeyProvider(env));
}

export function serializeEncryptedEnvelope(envelope: EncryptedEnvelope): string {
  return JSON.stringify(envelope);
}

export function parseEncryptedEnvelope(serialized: string): EncryptedEnvelope {
  const parsed = JSON.parse(serialized) as EncryptedEnvelope;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid encrypted envelope");
  }
  return parsed;
}
