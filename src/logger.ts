import { AsyncLocalStorage } from "node:async_hooks";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import {
  configure,
  dispose,
  getConsoleSink,
  getLogger,
  getStreamSink,
  getTextFormatter,
  jsonLinesFormatter,
  type LogLevel,
  type Sink,
  withContext,
} from "@logtape/logtape";
import { config } from "./config";

export { getLogger, withContext };

export const DEV_LOG_RELATIVE_PATH = path.join("logs", "codesmith-dev.log");

let configured = false;

// LogTape uses "warning" internally; our config schema uses "warn" — map it.
const LEVEL_MAP: Record<string, LogLevel> = {
  debug: "debug",
  info: "info",
  warn: "warning",
  error: "error",
};

function resolveDevLogPath(): string {
  return path.join(process.cwd(), DEV_LOG_RELATIVE_PATH);
}

function getSilentSink(): Sink {
  return () => {};
}

function getConsoleFormatter() {
  return getTextFormatter({
    timestamp: "rfc3339",
    format: ({ timestamp, level, message }) => `${timestamp} ${level} ${message}`,
  });
}

function getDebugFileSink(): Sink & AsyncDisposable {
  const logFilePath = resolveDevLogPath();
  mkdirSync(path.dirname(logFilePath), { recursive: true });

  const stream = createWriteStream(logFilePath, { flags: "a" });
  return getStreamSink(Writable.toWeb(stream), { formatter: jsonLinesFormatter });
}

/**
 * Initialise LogTape with a compact console sink and optional debug file sink
 * wired to config.LOG_LEVEL.
 * Must be called once, before any module calls getLogger().
 * Safe to call multiple times — subsequent calls are no-ops unless reset is
 * requested (for test teardown).
 */
export async function initLogging(): Promise<void> {
  if (configured) return;
  configured = true;

  const isTestEnv = Bun.env.NODE_ENV === "test";
  const enableDebugFile = !isTestEnv && config.LOG_LEVEL === "debug";

  const sinks: Record<string, Sink | (Sink & AsyncDisposable)> = {
    app: isTestEnv ? getSilentSink() : getConsoleSink({ formatter: getConsoleFormatter() }),
  };

  if (enableDebugFile) {
    sinks.devFile = getDebugFileSink();
  }

  const appSinkNames = Object.keys(sinks);

  await configure({
    reset: true,
    sinks,
    loggers: [
      {
        category: ["codesmith"],
        lowestLevel: LEVEL_MAP[config.LOG_LEVEL] ?? "info",
        sinks: appSinkNames,
      },
      // Silence the LogTape meta-logger advisory message
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: isTestEnv ? [] : appSinkNames },
    ],
    contextLocalStorage: new AsyncLocalStorage(),
  });
}

/**
 * Tear down LogTape. Used in tests to reset between configure() calls.
 */
export async function resetLogging(): Promise<void> {
  await dispose();
  configured = false;
}
