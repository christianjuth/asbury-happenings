import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FastifyBaseLogger } from "fastify";
import dayjs from "../src/calendar/calendar.dates.js";
import type { CalendarEvent } from "../src/calendar/calendar.types.js";

const KEY = "0123456789abcdef0123456789abcdef";
const SAMANTHA_DRESS_CONFIG = { id: "samantha-dress" };

type RefreshListener = (
  config: { id: string },
  events: CalendarEvent[],
) => void;

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
  vi.doUnmock("../src/calendar/calendar.cache.js");
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

  it("seeds the first refresh and submits a later changed event", async () => {
    vi.stubEnv("INDEXNOW_KEY", KEY);

    let refreshListener: RefreshListener | undefined;
    vi.doMock("../src/calendar/calendar.cache.js", () => ({
      onCalendarRefresh: (listener: RefreshListener) => {
        refreshListener = listener;
        return () => {};
      },
    }));

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    const logger = createLogger();
    const { startIndexNowScheduler } = await importScheduler();
    const stop = startIndexNowScheduler(logger as unknown as FastifyBaseLogger);
    const event: CalendarEvent = {
      uid: "scheduler-event@samanthadress.com",
      title: "Fall Trunk Show",
      start: dayjs("2026-09-17T22:00:00Z"),
      end: dayjs("2026-09-18T00:00:00Z"),
      location: "123 Main St, Freehold, NJ 07728",
      address: "123 Main St, Freehold, NJ 07728",
    };

    expect(refreshListener).toBeDefined();
    refreshListener?.(SAMANTHA_DRESS_CONFIG, [event]);
    refreshListener?.(SAMANTHA_DRESS_CONFIG, [event]);

    expect(fetchMock).not.toHaveBeenCalled();

    refreshListener?.(SAMANTHA_DRESS_CONFIG, [
      { ...event, title: "Fall Trunk Show (New Time)" },
    ]);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    stop();
  });

  it("does not schedule full reconciliations", async () => {
    vi.stubEnv("INDEXNOW_KEY", KEY);
    vi.setSystemTime(new Date("2026-09-01T06:59:00Z"));

    const fetchMock = vi.spyOn(globalThis, "fetch");
    const logger = createLogger();
    const { startIndexNowScheduler } = await importScheduler();
    const stop = startIndexNowScheduler(logger as unknown as FastifyBaseLogger);

    await vi.advanceTimersByTimeAsync(48 * 60 * 60_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { calendarId: "samantha-dress" },
      "IndexNow enabled for Samantha Dress calendar refreshes",
    );

    stop();
  });
});
