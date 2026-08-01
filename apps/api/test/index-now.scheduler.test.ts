import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FastifyBaseLogger } from "fastify";

const KEY = "0123456789abcdef0123456789abcdef";

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

async function importScheduler() {
  vi.resetModules();

  return import("../src/index-now/index-now.scheduler.js");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("startIndexNowScheduler", () => {
  it("disables itself without a key and schedules nothing", async () => {
    vi.stubEnv("INDEXNOW_KEY", "");
    vi.setSystemTime(new Date("2026-09-01T06:59:00Z"));

    const fetchMock = vi.spyOn(globalThis, "fetch");
    const logger = createLogger();
    const { startIndexNowScheduler } = await importScheduler();
    const stop = startIndexNowScheduler(logger as unknown as FastifyBaseLogger);

    await vi.advanceTimersByTimeAsync(2 * 60_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.anything(),
      "IndexNow disabled because INDEXNOW_KEY is not configured",
    );

    stop();
  });

  // A restart minutes before the anchor hour reaches it before the calendar has
  // warmed. Submitting then would push a lone /events and overwrite the
  // fingerprint map with an empty snapshot.
  it("defers reconciliation while the calendar cache is cold", async () => {
    vi.stubEnv("INDEXNOW_KEY", KEY);
    vi.setSystemTime(new Date("2026-09-01T06:59:00Z"));

    const fetchMock = vi.spyOn(globalThis, "fetch");
    const logger = createLogger();
    const { startIndexNowScheduler } = await importScheduler();
    const stop = startIndexNowScheduler(logger as unknown as FastifyBaseLogger);

    // Past the 07:00 UTC anchor.
    await vi.advanceTimersByTimeAsync(2 * 60_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ retryInMs: 15 * 60_000 }),
      "IndexNow daily reconciliation deferred until the calendar cache is warm",
    );

    // Still cold 15 minutes later: retries rather than submitting or giving up
    // until the next day.
    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(2);

    stop();
  });

  it("stops scheduling after the returned stop function runs", async () => {
    vi.stubEnv("INDEXNOW_KEY", KEY);
    vi.setSystemTime(new Date("2026-09-01T06:59:00Z"));

    const logger = createLogger();
    const { startIndexNowScheduler } = await importScheduler();
    const stop = startIndexNowScheduler(logger as unknown as FastifyBaseLogger);

    stop();
    await vi.advanceTimersByTimeAsync(48 * 60 * 60_000);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
