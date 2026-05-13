/**
 * PII Masker for Log Messages and Error Messages
 *
 * Replaces Personally Identifiable Information patterns in log output
 * to prevent sensitive data leakage in logs, error traces, and audit trails.
 *
 * Patterns covered:
 * - Email addresses: user@example.com → ***
 * - Phone numbers: +1 (555) 123-4567 → ***
 * - Bearer tokens: Bearer sk_... → Bearer ***
 * - Secret tokens: sk-* / sf-* → ***
 * - Salesforce IDs: 15/18 character IDs → ***
 * - Credit cards: 4532 1234 5678 9010 → ***
 * - SSN: 123-45-6789 → ***
 * - AWS access keys: AKIA... → ***
 * - SSH public keys: ssh-rsa ... → ***
 * - JWT tokens: eyJhbGc... → ***
 */

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi;
const SECRET_TOKEN_PATTERN = /\b(?:sk|sf)-[A-Za-z0-9\-._]{8,}\b/g;
const SALESFORCE_ID_PATTERN = /\b(?=[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?\b)(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?\b/g;
const CREDIT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const AWS_ACCESS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16,}\b/g;
const SSH_PUBLIC_KEY_PATTERN = /\bssh-(?:rsa|ed25519|dss|ecdsa)\s+[A-Za-z0-9+/=.-]+(?:\s+[^\s]+)?\b/gi;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.?[A-Za-z0-9_-]*\b/g;

/**
 * Mask a single string by applying all PII patterns.
 * Replaces matched patterns with standardized tokens (e.g., "***", "***").
 */
function maskString(value: string): string {
  if (!value || typeof value !== "string") {
    return value;
  }

  return value
    .replace(EMAIL_PATTERN, "***")
    .replace(PHONE_PATTERN, "***")
    .replace(BEARER_PATTERN, "Bearer ***")
    .replace(SECRET_TOKEN_PATTERN, "***")
    .replace(SALESFORCE_ID_PATTERN, "***")
    .replace(CREDIT_CARD_PATTERN, "***")
    .replace(SSN_PATTERN, "***")
    .replace(AWS_ACCESS_KEY_PATTERN, "***")
    .replace(SSH_PUBLIC_KEY_PATTERN, "***")
    .replace(JWT_PATTERN, "[JWT]");
}

/**
 * Recursively mask all values in an object, handling circular references.
 */
function maskObject(value: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
  if (seen.has(value)) {
    return { circular: true };
  }
  seen.add(value);

  const entries = Object.entries(value).map(([key, item]) => [key, maskUnknown(item, seen)]);
  return Object.fromEntries(entries);
}

/**
 * Recursively mask PII in any value (string, array, object, etc.).
 * Safe against circular references using WeakSet.
 *
 * @param value - The value to mask
 * @param seen - Internal WeakSet tracking seen objects (auto-initialized)
 * @returns Masked value with PII replaced
 */
export function maskUnknown(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return maskString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskUnknown(item, seen));
  }
  if (value && typeof value === "object") {
    return maskObject(value as Record<string, unknown>, seen);
  }
  return value;
}

/**
 * Mask a log message string, removing PII patterns.
 *
 * @param message - Log message text
 * @returns Masked message with PII replaced
 */
export function maskLogMessage(message: string): string {
  return maskString(message);
}
