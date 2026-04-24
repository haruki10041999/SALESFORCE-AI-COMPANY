const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /\b(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)\d{2,4}[\s-]?\d{3,4}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi;
const SECRET_TOKEN_PATTERN = /\b(?:sk|sf)-[A-Za-z0-9\-._]{8,}\b/g;
const SALESFORCE_ID_PATTERN = /\b(?=[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?\b)(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?\b/g;
const CREDIT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;

function maskString(value: string): string {
  return value
    .replace(EMAIL_PATTERN, "***")
    .replace(PHONE_PATTERN, "***")
    .replace(BEARER_PATTERN, "Bearer ***")
    .replace(SECRET_TOKEN_PATTERN, "***")
    .replace(SALESFORCE_ID_PATTERN, "***")
    .replace(CREDIT_CARD_PATTERN, "***");
}

function maskObject(value: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
  if (seen.has(value)) {
    return { circular: true };
  }
  seen.add(value);

  const entries = Object.entries(value).map(([key, item]) => [key, maskUnknown(item, seen)]);
  return Object.fromEntries(entries);
}

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

export function maskLogMessage(message: string): string {
  return maskString(message);
}
