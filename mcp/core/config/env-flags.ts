const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export function parseBooleanLike(value: string | undefined | null, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }
  return fallback;
}

export function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  return parseBooleanLike(value, fallback);
}

export function isEnvFlagEnabled(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
  fallback = false
): boolean {
  return parseBooleanLike(env[key], fallback);
}
