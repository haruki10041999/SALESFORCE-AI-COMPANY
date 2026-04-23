export type LogLevel = "error" | "warn" | "info" | "debug";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

function normalizeLogLevel(value: string | undefined): LogLevel {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "error" || normalized === "warn" || normalized === "info" || normalized === "debug") {
    return normalized;
  }
  return "info";
}

function shouldLog(current: LogLevel, target: LogLevel): boolean {
  return LOG_LEVEL_ORDER[target] <= LOG_LEVEL_ORDER[current];
}

function formatLogPrefix(level: LogLevel, scope: string): string {
  return `[${level.toUpperCase()}][${scope}]`;
}

export interface Logger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export function createLogger(scope: string, configuredLevel?: string): Logger {
  const level = normalizeLogLevel(configuredLevel ?? process.env.LOG_LEVEL);

  return {
    error(message: string, ...args: unknown[]): void {
      if (shouldLog(level, "error")) {
        console.error(formatLogPrefix("error", scope), message, ...args);
      }
    },
    warn(message: string, ...args: unknown[]): void {
      if (shouldLog(level, "warn")) {
        console.warn(formatLogPrefix("warn", scope), message, ...args);
      }
    },
    info(message: string, ...args: unknown[]): void {
      if (shouldLog(level, "info")) {
        console.info(formatLogPrefix("info", scope), message, ...args);
      }
    },
    debug(message: string, ...args: unknown[]): void {
      if (shouldLog(level, "debug")) {
        console.debug(formatLogPrefix("debug", scope), message, ...args);
      }
    }
  };
}
