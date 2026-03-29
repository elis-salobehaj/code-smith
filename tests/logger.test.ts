import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { configure, getConfig, getLogger, type LogRecord } from "@logtape/logtape";
import { DEV_LOG_RELATIVE_PATH, initLogging, resetLogging } from "../src/logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CapturedRecord = LogRecord & { properties: Record<string, unknown> };
const devLogPath = path.join(process.cwd(), DEV_LOG_RELATIVE_PATH);

async function configureCapturing(level: "debug" | "info" | "warning" | "error"): Promise<CapturedRecord[]> {
  const captured: CapturedRecord[] = [];
  await configure({
    reset: true,
    sinks: {
      capture: (record) => {
        captured.push(record as CapturedRecord);
      },
    },
    loggers: [
      { category: ["codesmith"], lowestLevel: level, sinks: ["capture"] },
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: [] },
    ],
  });
  return captured;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LogTape level filtering", () => {
  afterEach(async () => {
    await resetLogging();
  });

  test("emits records at or above the configured level", async () => {
    const captured = await configureCapturing("warning");
    const logger = getLogger(["codesmith", "test"]);

    logger.debug("should be filtered");
    logger.info("should be filtered");
    logger.warn("should appear");
    logger.error("should appear");

    expect(captured).toHaveLength(2);
    expect(captured[0].level).toBe("warning");
    expect(captured[1].level).toBe("error");
  });

  test("emits nothing when level is above all calls", async () => {
    const captured = await configureCapturing("error");
    const logger = getLogger(["codesmith", "test"]);

    logger.debug("filtered");
    logger.info("filtered");
    logger.warn("filtered");

    expect(captured).toHaveLength(0);
  });

  test("emits all levels when configured to debug", async () => {
    const captured = await configureCapturing("debug");
    const logger = getLogger(["codesmith", "test"]);

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(captured).toHaveLength(4);
  });
});

describe("LogTape structured properties", () => {
  afterEach(async () => {
    await resetLogging();
  });

  test("properties are attached to the log record", async () => {
    const captured = await configureCapturing("info");
    const logger = getLogger(["codesmith", "test"]);

    logger.info("MR processed", { projectId: 42, mrIid: 7, verdict: "APPROVE" });

    expect(captured).toHaveLength(1);
    expect(captured[0].properties).toMatchObject({ projectId: 42, mrIid: 7, verdict: "APPROVE" });
  });
});

describe("LogTape category hierarchy", () => {
  afterEach(async () => {
    await resetLogging();
  });

  test("child categories inherit the parent sink", async () => {
    const captured = await configureCapturing("info");

    // loggers in child categories should route through the parent ["codesmith"] config
    const routerLogger = getLogger(["codesmith", "router"]);
    const publisherLogger = getLogger(["codesmith", "publisher"]);

    routerLogger.info("router message");
    publisherLogger.info("publisher message");

    expect(captured).toHaveLength(2);
    expect(captured[0].category).toEqual(["codesmith", "router"]);
    expect(captured[1].category).toEqual(["codesmith", "publisher"]);
  });
});

describe("initLogging in test mode", () => {
  afterEach(async () => {
    await resetLogging();
    rmSync(devLogPath, { force: true });
  });

  test("uses the silent app sink and does not create the debug log file", async () => {
    rmSync(devLogPath, { force: true });

    await initLogging();
    const logger = getLogger(["codesmith", "test"]);
    logger.info("should stay silent under bun test");

    const activeConfig = getConfig();

    expect(activeConfig).not.toBeNull();
    expect(Object.keys(activeConfig?.sinks ?? {})).toEqual(["app"]);
    expect(activeConfig?.loggers[0]?.sinks).toEqual(["app"]);
    expect(existsSync(devLogPath)).toBe(false);
  });
});
