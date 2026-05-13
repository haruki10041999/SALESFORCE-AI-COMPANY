import { createPublicKey, verify as verifySignature } from "node:crypto";
import { isEnvFlagEnabled } from "../../core/config/env-flags.js";
import type { ActorIdentity } from "./actor.js";

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface JwtPayload {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  role?: string;
  roles?: string[];
  groups?: string[];
  name?: string;
  preferred_username?: string;
  email?: string;
  tenant_id?: string;
  tid?: string;
  [key: string]: unknown;
}

interface Jwk {
  [key: string]: unknown;
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  x5c?: string[];
}

interface Jwks {
  keys?: Jwk[];
}

export interface OidcVerifyOptions {
  issuer?: string;
  audience?: string;
  jwksUrl?: string;
  roleClaim?: string;
  tenantClaim?: string;
  authMode?: "disabled" | "jwt" | "mtls";
  allowInsecureUnsigned?: boolean;
  clockSkewSec?: number;
}

export interface OidcVerifiedIdentity {
  actor: Partial<ActorIdentity>;
  claims: JwtPayload;
}

const jwksCache = new Map<string, { expiresAt: number; keys: Jwk[] }>();

function decodeBase64UrlJson<T>(value: string): T {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as T;
}

function decodeBase64UrlBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  return Buffer.from(padded, "base64");
}

function splitJwt(token: string): { headerB64: string; payloadB64: string; signatureB64: string } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }
  return { headerB64: parts[0]!, payloadB64: parts[1]!, signatureB64: parts[2]! };
}

function pickClaimAsString(payload: JwtPayload, claimName: string): string | undefined {
  const value = payload[claimName];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function mapRoleFromClaims(payload: JwtPayload, roleClaim?: string): string | undefined {
  const claimOrder = [roleClaim, "role", "roles", "groups"].filter((name): name is string => Boolean(name));
  for (const claim of claimOrder) {
    const value = payload[claim];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const first = value.find((v) => typeof v === "string" && v.trim().length > 0);
      if (typeof first === "string") {
        return first.trim();
      }
    }
  }
  return undefined;
}

function mapTenantFromClaims(payload: JwtPayload, tenantClaim?: string): string | undefined {
  const fromCustom = tenantClaim ? pickClaimAsString(payload, tenantClaim) : undefined;
  return fromCustom ?? pickClaimAsString(payload, "tenant_id") ?? pickClaimAsString(payload, "tid");
}

function verifyStandardClaims(payload: JwtPayload, options: OidcVerifyOptions): void {
  const nowSec = Math.floor(Date.now() / 1000);
  const skew = Math.max(0, options.clockSkewSec ?? 60);

  if (typeof payload.exp === "number" && nowSec > payload.exp + skew) {
    throw new Error("JWT is expired");
  }
  if (typeof payload.nbf === "number" && nowSec + skew < payload.nbf) {
    throw new Error("JWT not yet valid");
  }
  if (options.issuer && payload.iss !== options.issuer) {
    throw new Error(`JWT issuer mismatch: expected ${options.issuer}`);
  }
  if (options.audience) {
    const aud = payload.aud;
    const matched = typeof aud === "string"
      ? aud === options.audience
      : Array.isArray(aud) && aud.includes(options.audience);
    if (!matched) {
      throw new Error(`JWT audience mismatch: expected ${options.audience}`);
    }
  }
}

async function loadJwks(jwksUrl: string): Promise<Jwk[]> {
  const now = Date.now();
  const cached = jwksCache.get(jwksUrl);
  if (cached && cached.expiresAt > now) {
    return cached.keys;
  }
  const response = await fetch(jwksUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }
  const data = await response.json() as Jwks;
  const keys = Array.isArray(data.keys) ? data.keys : [];
  jwksCache.set(jwksUrl, {
    keys,
    expiresAt: now + 5 * 60 * 1000
  });
  return keys;
}

function findVerificationKey(keys: Jwk[], header: JwtHeader): Jwk {
  const preferred = keys.find((key) => key.kid && header.kid && key.kid === header.kid);
  const fallback = preferred ?? keys.find((key) => key.kty === "RSA");
  if (!fallback) {
    throw new Error("No matching JWKS key for JWT");
  }
  return fallback;
}

function verifyJwtSignature(token: string, header: JwtHeader, key: Jwk): void {
  if (!header.alg || header.alg !== "RS256") {
    throw new Error(`Unsupported JWT alg: ${header.alg ?? "unknown"}`);
  }

  const { headerB64, payloadB64, signatureB64 } = splitJwt(token);
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = decodeBase64UrlBuffer(signatureB64);

  const keyObject = createPublicKey({ key, format: "jwk" } as never);
  const ok = verifySignature("RSA-SHA256", Buffer.from(signingInput, "utf-8"), keyObject, signature);
  if (!ok) {
    throw new Error("JWT signature verification failed");
  }
}

export async function verifyOidcToken(token: string, options: OidcVerifyOptions): Promise<OidcVerifiedIdentity> {
  const { headerB64, payloadB64 } = splitJwt(token);
  const header = decodeBase64UrlJson<JwtHeader>(headerB64);
  const payload = decodeBase64UrlJson<JwtPayload>(payloadB64);

  if (header.alg === "none") {
    if (!options.allowInsecureUnsigned) {
      throw new Error("Unsigned JWT is not allowed");
    }
  } else {
    if (!options.jwksUrl || options.jwksUrl.trim().length === 0) {
      throw new Error("SF_AI_OIDC_JWKS_URL is required in jwt auth mode");
    }
    const keys = await loadJwks(options.jwksUrl);
    const key = findVerificationKey(keys, header);
    verifyJwtSignature(token, header, key);
  }

  verifyStandardClaims(payload, options);

  const subject = pickClaimAsString(payload, "sub");
  if (!subject) {
    throw new Error("JWT subject (sub) is required");
  }

  const role = mapRoleFromClaims(payload, options.roleClaim);
  const tenantId = mapTenantFromClaims(payload, options.tenantClaim);
  const displayName = pickClaimAsString(payload, "name")
    ?? pickClaimAsString(payload, "preferred_username")
    ?? pickClaimAsString(payload, "email");

  return {
    actor: {
      type: "user",
      id: subject,
      role,
      tenantId,
      displayName,
      metadata: {
        source: "oidc",
        iss: payload.iss,
        aud: payload.aud,
        iat: payload.iat,
        exp: payload.exp
      }
    },
    claims: payload
  };
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function extractBearerTokenFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const record = input as Record<string, unknown>;

  const directHeaders = [
    readString(record, "authorization"),
    readString(record, "Authorization")
  ];
  for (const header of directHeaders) {
    if (header?.toLowerCase().startsWith("bearer ")) {
      return header.slice(7).trim();
    }
  }

  const headers = record.headers;
  if (headers && typeof headers === "object") {
    const headersRecord = headers as Record<string, unknown>;
    const authHeader = readString(headersRecord, "authorization") ?? readString(headersRecord, "Authorization");
    if (authHeader?.toLowerCase().startsWith("bearer ")) {
      return authHeader.slice(7).trim();
    }
  }

  const auth = record.auth;
  if (auth && typeof auth === "object") {
    const authRecord = auth as Record<string, unknown>;
    for (const key of ["token", "accessToken", "idToken", "bearerToken"]) {
      const token = readString(authRecord, key);
      if (token) return token;
    }
  }

  return undefined;
}

export async function resolveActorFromOidcInput(input: unknown, env: NodeJS.ProcessEnv = process.env): Promise<Partial<ActorIdentity> | undefined> {
  const authMode = (env.SF_AI_AUTH_MODE ?? "disabled").toLowerCase();
  if (authMode !== "jwt") {
    return undefined;
  }

  const token = extractBearerTokenFromInput(input);
  if (!token) {
    throw new Error("JWT auth mode requires bearer token in input.authorization or input.auth.token");
  }

  const verified = await verifyOidcToken(token, {
    authMode: "jwt",
    issuer: env.SF_AI_OIDC_ISSUER,
    audience: env.SF_AI_OIDC_AUDIENCE,
    jwksUrl: env.SF_AI_OIDC_JWKS_URL,
    roleClaim: env.SF_AI_OIDC_ROLE_CLAIM,
    tenantClaim: env.SF_AI_OIDC_TENANT_CLAIM,
    allowInsecureUnsigned: isEnvFlagEnabled("SF_AI_OIDC_ALLOW_INSECURE_UNSIGNED", env)
  });

  return verified.actor;
}
