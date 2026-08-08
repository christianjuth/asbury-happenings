import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearCalendarPageCache,
  getCachedCalendarFeed,
  warmCalendarPage,
} from "../src/calendar/calendar.cache.js";
import { getCalendarSource } from "../src/calendar/calendar.config.js";
import dayjs from "../src/calendar/calendar.dates.js";
import { clearCalendarFetchState } from "../src/calendar/calendar.service.js";
import {
  clearSamanthaDressEventSnapshot,
  getSamanthaDressEventSnapshot,
  startSamanthaDressEventsScheduler,
} from "../src/samantha-dress/samantha-dress.cache.js";
import { clearSamanthaDressFetchState } from "../src/samantha-dress/samantha-dress.fetch.js";

const NOW = dayjs("2026-08-03T00:00:00Z");

afterEach(() => {
  clearCalendarPageCache();
  clearCalendarFetchState();
  clearSamanthaDressEventSnapshot();
  clearSamanthaDressFetchState();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Samantha Dress events cache", () => {
  it("polls every five minutes without changing the legacy ICS snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW.toDate());

    const source = getCalendarSource("samantha-dress");

    if (!source) {
      throw new Error("Missing Samantha Dress calendar config");
    }

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        const eventNumber = fetchMock.mock.calls.length;
        const title = eventNumber === 1 ? "Legacy event" : "JSON event";

        return new Response(
          [
            "BEGIN:VCALENDAR",
            "BEGIN:VEVENT",
            `UID:${title.toLowerCase().replaceAll(" ", "-")}`,
            `SUMMARY:${title}`,
            "DTSTART:20260910T230000Z",
            "DTEND:20260911T020000Z",
            "END:VEVENT",
            "END:VCALENDAR",
          ].join("\r\n"),
        );
      });

    await warmCalendarPage(source, 0, NOW);
    const legacyFeed = getCachedCalendarFeed(source, undefined, NOW);
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const stop = startSamanthaDressEventsScheduler(logger);

    await vi.waitUntil(
      () => getSamanthaDressEventSnapshot().events[0]?.title === "JSON event",
    );

    expect(legacyFeed).toContain("SUMMARY:Legacy event");
    expect(getCachedCalendarFeed(source, undefined, NOW)).toContain(
      "SUMMARY:Legacy event",
    );

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getSamanthaDressEventSnapshot().events[0]?.title).toBe("JSON event");
    expect(getCachedCalendarFeed(source, undefined, NOW)).toContain(
      "SUMMARY:Legacy event",
    );

    await stop();
  });

  it("times out a stalled source request", async () => {
    vi.useFakeTimers();
    const { fetchMock } = mockHangingFetch();
    const logger = createLogger();
    const stop = startSamanthaDressEventsScheduler(logger);

    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "samantha-dress" }),
      "Samantha Dress events cache refresh failed",
    );
    await stop();
  });

  it("aborts a stalled source request during shutdown", async () => {
    const { signals } = mockHangingFetch();
    const stop = startSamanthaDressEventsScheduler(createLogger());

    await stop();

    expect(signals[0]?.aborted).toBe(true);
  });
});

function createLogger() {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function mockHangingFetch() {
  const signals: AbortSignal[] = [];
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_input, init) => {
      const signal = init?.signal;

      if (!signal) {
        throw new Error("Expected the source request to carry an abort signal");
      }

      signals.push(signal);

      return new Promise<Response>((_resolve, reject) => {
        const rejectOnAbort = () => reject(signal.reason);

        if (signal.aborted) {
          rejectOnAbort();
          return;
        }

        signal.addEventListener("abort", rejectOnAbort, { once: true });
      });
    });

  return { fetchMock, signals };
}
