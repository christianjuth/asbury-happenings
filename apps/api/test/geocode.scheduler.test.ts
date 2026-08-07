import { afterEach, describe, expect, it, vi } from "vitest";

import type { FastifyBaseLogger } from "fastify";

import type { CalendarSourceConfig } from "../src/calendar/calendar.types.js";

const NOMINATIM_HOST = "nominatim.openstreetmap.org";

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// The scheduler claims the store singleton at module scope, so each test needs a
// fresh module graph to start from an empty store.
async function importModules() {
  vi.resetModules();

  return {
    scheduler: await import("../src/geocode/geocode.scheduler.js"),
    cache: await import("../src/calendar/calendar.cache.js"),
    config: await import("../src/calendar/calendar.config.js"),
    samanthaDress:
      await import("../src/samantha-dress/samantha-dress.service.js"),
  };
}

function icsFeed(location: string) {
  return [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:scheduler-event",
    "SUMMARY:Sunset Set",
    "DTSTART:20260910T230000Z",
    "DTEND:20260911T020000Z",
    `LOCATION:${location}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startGeocodeScheduler", () => {
  // The point of running as a separate job: the events are already cached and
  // queryable while the geocode request is still in flight, so a slow or
  // rate-limited provider cannot delay event freshness.
  it("caches events first and decorates them afterwards", async () => {
    const logger = createLogger();
    const { scheduler, cache, config, samanthaDress } = await importModules();
    let releaseGeocode = (_response: Response) => {};
    const geocodeRequested = new Promise<void>((resolveRequested) => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        if (!String(input).includes(NOMINATIM_HOST)) {
          return new Response(
            icsFeed("The Boardwalk, 100 Ocean Ave, Ship Bottom, NJ"),
          );
        }

        return new Promise<Response>((resolveResponse) => {
          releaseGeocode = resolveResponse;
          resolveRequested();
        });
      });
    });
    const source = config.getCalendarSource("samantha-dress");

    if (!source) {
      throw new Error("Missing Samantha Dress calendar config");
    }

    const stopGeocode = scheduler.startGeocodeScheduler(
      logger as unknown as FastifyBaseLogger,
    );
    const stopCalendars = cache.startCalendarCacheScheduler(
      logger as unknown as FastifyBaseLogger,
    );

    await geocodeRequested;

    // The geocoder has not answered yet, and the event is already served.
    expect(cache.getCachedCalendarEvents(source)).toHaveLength(1);
    expect(
      samanthaDress.getSamanthaDressSnapshot().events[0]?.location,
    ).toMatchObject({ coordinates: null, coordinatesStatus: "pending" });

    releaseGeocode(
      new Response(
        JSON.stringify([
          {
            lat: "39.6423",
            lon: "-74.1815",
            address: {
              town: "Ship Bottom",
              "ISO3166-2-lvl4": "US-NJ",
              country_code: "us",
            },
          },
        ]),
        { headers: { "content-type": "application/json" } },
      ),
    );

    await vi.waitUntil(
      () =>
        samanthaDress.getSamanthaDressSnapshot().events[0]?.location
          .coordinatesStatus === "resolved",
      { timeout: 5_000 },
    );

    expect(
      samanthaDress.getSamanthaDressSnapshot().events[0]?.location.coordinates,
    ).toEqual({ lat: 39.6423, lon: -74.1815 });

    await stopGeocode();
    await stopCalendars();
    cache.clearCalendarPageCache();
  }, 20_000);

  it("stops geocoding after the returned stop function runs", async () => {
    const logger = createLogger();
    const { scheduler, cache, config } = await importModules();
    const fetchMock = mockCalendarFetch();
    const stopGeocode = scheduler.startGeocodeScheduler(
      logger as unknown as FastifyBaseLogger,
    );

    await stopGeocode();

    const stopCalendars = cache.startCalendarCacheScheduler(
      logger as unknown as FastifyBaseLogger,
    );
    const source = requireSamanthaDress(config);

    await vi.waitUntil(
      () => cache.getCachedCalendarEvents(source).length === 1,
      { timeout: 10_000 },
    );

    expect(geocodeCalls(fetchMock)).toEqual([]);

    await stopCalendars();
    cache.clearCalendarPageCache();
  }, 20_000);
});

// A fresh Response per call: every calendar source is warmed here, and a body
// can only be read once.
function mockCalendarFetch() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () =>
        new Response(icsFeed("The Boardwalk, 100 Ocean Ave, Ship Bottom, NJ")),
    );
}

function geocodeCalls(fetchMock: {
  mock: { calls: unknown[][] };
}): unknown[][] {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).includes(NOMINATIM_HOST),
  );
}

function requireSamanthaDress(config: {
  getCalendarSource(id: string): CalendarSourceConfig | undefined;
}): CalendarSourceConfig {
  const source = config.getCalendarSource("samantha-dress");

  if (!source) {
    throw new Error("Missing Samantha Dress calendar config");
  }

  return source;
}
