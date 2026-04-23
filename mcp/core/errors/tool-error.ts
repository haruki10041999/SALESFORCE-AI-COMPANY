export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.toLowerCase();
  }
  return String(error).toLowerCase();
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

export function readErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  const candidate = error as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    cause?: { code?: unknown; status?: unknown; statusCode?: unknown };
  };
  const raw =
    candidate.code ??
    candidate.statusCode ??
    candidate.status ??
    candidate.cause?.code ??
    candidate.cause?.statusCode ??
    candidate.cause?.status;

  if (raw === undefined || raw === null) {
    return "";
  }

  return String(raw).toUpperCase();
}

export function isRetryableError(error: unknown, patterns: string[]): boolean {
  const message = toErrorMessage(error);
  return patterns.some((pattern) => message.includes(pattern.toLowerCase()));
}

export function isRetryableByCode(error: unknown, codes: string[]): boolean {
  const code = readErrorCode(error);
  if (!code) {
    return false;
  }

  const normalizedCodes = codes.map((item) => item.toUpperCase());
  return normalizedCodes.includes(code);
}