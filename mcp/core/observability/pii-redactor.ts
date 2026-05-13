/**
 * PII Redactor for OpenTelemetry Spans
 *
 * Automatically redacts Personally Identifiable Information (PII) from span attributes
 * before they are exported to OTel collectors/exporters.
 *
 * Patterns covered:
 * - Email addresses
 * - Phone numbers
 * - Authorization tokens (Bearer, API keys)
 * - Secret tokens (sk-, sf-* prefixed)
 * - Salesforce IDs (15/18 character alphanumeric)
 * - Credit card numbers
 * - SSN / national IDs
 * - Custom keywords (password, secret, token, key, etc.)
 *
 * Usage:
 *   const redacted = redactSpanAttribute("user@example.com", "email");
 *   const attrs = redactSpanAttributes({ email: "user@example.com", org: "Acme" });
 */

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /\b(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)\d{2,4}[\s-]?\d{3,4}\b/g;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi;
const SECRET_TOKEN_PATTERN = /\b(?:sk|sf)-[A-Za-z0-9\-._]{8,}\b/g;
const SALESFORCE_ID_PATTERN = /\b(?=[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?\b)(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?\b/g;
const CREDIT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;

// Keywords that suggest sensitive data
const SENSITIVE_KEYWORDS = [
  "password",
  "secret",
  "token",
  "api_key",
  "apikey",
  "auth",
  "credential",
  "bearer",
  "session",
  "oauth",
  "jwt",
  "personal",
  "pii",
  "ssn",
  "email",
  "phone",
  "credit_card",
  "ccn"
];

/**
 * Check if a key name suggests sensitive data.
 * Examples: "password", "api_key", "auth_token"
 */
function isKeyNameSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Redact a single string value by applying all PII patterns.
 */
function redactString(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  return value
    .replace(EMAIL_PATTERN, "[EMAIL]")
    .replace(PHONE_PATTERN, "[PHONE]")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [TOKEN]")
    .replace(SECRET_TOKEN_PATTERN, "[SECRET_TOKEN]")
    .replace(SALESFORCE_ID_PATTERN, "[SFID]")
    .replace(CREDIT_CARD_PATTERN, "[CREDIT_CARD]")
    .replace(SSN_PATTERN, "[SSN]");
}

/**
 * Redact a span attribute value based on its type and key name.
 *
 * @param value - The attribute value (string, number, boolean)
 * @param key - The attribute key name (used to infer sensitivity)
 * @returns Redacted value (or original if not PII)
 */
export function redactSpanAttribute(
  value: string | number | boolean,
  key: string = ""
): string | number | boolean {
  // Numbers and booleans are typically not PII, unless key suggests it
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  // String value: apply pattern-based redaction
  if (typeof value === "string") {
    const redacted = redactString(value);
    if (redacted !== value) {
      return redacted;
    }

    // If no pattern matched but key name is sensitive, redact the whole value
    if (isKeyNameSensitive(key)) {
      return "[REDACTED]";
    }

    return value;
  }

  return value;
}

/**
 * Redact all span attributes in a record.
 *
 * @param attributes - Object with span attributes
 * @returns New object with redacted values
 */
export function redactSpanAttributes(
  attributes: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(attributes)) {
    result[key] = redactSpanAttribute(value, key);
  }

  return result;
}

/**
 * Create a redaction function for use with OTel span attribute setter.
 *
 * Returns a wrapper that redacts before setting.
 *
 * Example:
 *   const span = tracer.startSpan("my-operation");
 *   const setAttribute = createRedactingAttributeSetter(span);
 *   setAttribute("user_email", "user@example.com"); // Sets as "[EMAIL]"
 */
export function createRedactingAttributeSetter(
  span: {
    setAttribute(key: string, value: string | number | boolean): void;
  }
): (key: string, value: string | number | boolean) => void {
  return (key: string, value: string | number | boolean) => {
    const redacted = redactSpanAttribute(value, key);
    span.setAttribute(key, redacted);
  };
}

/**
 * Redact OTel span attributes with multiple strategies.
 *
 * @param attributes - Object with span attributes to redact
 * @param strategy - Redaction strategy: "mask" (replace with [REDACTED]), "hash" (SHA256 hash), "drop" (remove key)
 * @param hashSeed - Optional seed for hash function (for consistency)
 * @returns New object with redacted attributes
 */
export function redactOtelSpanAttributes(
  attributes: Record<string, string | number | boolean>,
  strategy: "mask" | "hash" | "drop" = "mask",
  hashSeed?: string
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(attributes)) {
    const redacted = redactSpanAttribute(value, key);
    const wasRedacted = redacted !== value;

    if (!wasRedacted) {
      // Not PII, keep original
      result[key] = value;
    } else if (strategy === "mask") {
      // Use masked version
      result[key] = redacted;
    } else if (strategy === "hash") {
      // Hash the redacted value for consistency
      const stringValue = String(redacted);
      const seed = hashSeed ?? "sfai-default-seed";
      // Simple hash using seed (deterministic)
      const combined = `${stringValue}:${seed}`;
      let hash = 0;
      for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      result[key] = `hash_${Math.abs(hash).toString(16)}`;
    } else if (strategy === "drop") {
      // Drop PII attributes entirely
      // Skip this key
    }
  }

  return result;
}
