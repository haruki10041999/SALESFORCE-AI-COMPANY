export type LogLevel = "error" | "warn" | "info" | "debug";

import pino from "pino";
import pretty from "pino-pretty";
import { maskLogMessage, maskUnknown } from "./pii-masker.js";

function normalizeLogLevel(value: string | undefined): LogLevel {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "error" || normalized === "warn" || normalized === "info" || normalized === "debug") {
    return normalized;
  }
  return "info";
}

export interface Logger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

const rootLoggerCache = new Map<LogLevel, pino.Logger>();

function createDestinationStream() {
  return pretty({
    colorize: process.stderr.isTTY,
    destination: 2,
    ignore: "pid,hostname",
    messageFormat: (log, messageKey) => {
      const scope = typeof log.scope === "string" ? log.scope : "App";
      const message = typeof log[messageKey] === "string" ? log[messageKey] : "";
      return `[${scope}] ${message}`;
    },
    sync: true,
    translateTime: "SYS:standard"
  });
}

function getRootLogger(level: LogLevel): pino.Logger {
  const cached = rootLoggerCache.get(level);
  if (cached) {
    return cached;
  }

  const logger = pino(
    {
      base: undefined,
      formatters: {
        level: (label) => ({ level: label.toUpperCase() })
      },
      level,
      timestamp: pino.stdTimeFunctions.isoTime
    },
    createDestinationStream()
  );
  rootLoggerCache.set(level, logger);
  return logger;
}

function writeLog(logger: pino.Logger, level: LogLevel, message: string, args: unknown[]): void {
  const maskedMessage = maskLogMessage(message);
  const maskedArgs = args.map((arg) => maskUnknown(arg));

  if (maskedArgs.length === 0) {
    logger[level](maskedMessage);
    return;
  }

  if (
    maskedArgs.length === 1 &&
    typeof maskedArgs[0] === "object" &&
    maskedArgs[0] !== null &&
    !Array.isArray(maskedArgs[0])
  ) {
    logger[level](maskedArgs[0] as object, maskedMessage);
    return;
  }

  logger[level]({ args: maskedArgs }, maskedMessage);
}

export function createLogger(scope: string, configuredLevel?: string): Logger {
  const level = normalizeLogLevel(configuredLevel ?? process.env.LOG_LEVEL);
  const scopedLogger = getRootLogger(level).child({ scope });

  return {
    error(message: string, ...args: unknown[]): void {
      writeLog(scopedLogger, "error", message, args);
    },
    warn(message: string, ...args: unknown[]): void {
      writeLog(scopedLogger, "warn", message, args);
    },
    info(message: string, ...args: unknown[]): void {
      writeLog(scopedLogger, "info", message, args);
    },
    debug(message: string, ...args: unknown[]): void {
      writeLog(scopedLogger, "debug", message, args);
    }
  };
}
