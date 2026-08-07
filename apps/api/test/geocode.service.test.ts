import { describe, expect, it, vi } from "vitest";

import dayjs from "../src/calendar/calendar.dates.js";
import type { CalendarEvent } from "../src/calendar/calendar.types.js";
import {
  collectGeocodeTargets,
  createGeocodeDecorationJob,
} from "../src/geocode/geocode.service.js";
import {
  buildCoordinateRecord,
  createCoordinateStore,
  type CoordinateStore,
} from "../src/geocode/geocode.store.js";
import type { GeocodeQueryResult } from "../src/geocode/nominatim.js";

const NOW = dayjs("2026-08-03T12:00:00Z");

const SHIP_BOTTOM = "The Boardwalk, 100 Ocean Ave, Ship Bottom, NJ";
const SAND_BAR = "The Sand Bar, 1 Bay Ave, Beach Haven, NJ";
const WONDER_BAR = "The Wonder Bar, 1213 Ocean Ave, Asbury Park, NJ";

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createEvent(
  location: string,
  start: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    title: `Show at ${location}`,
    start: dayjs(start),
    end: dayjs(start).add(3, "hour"),
    location,
    address: location,
    ...overrides,
  };
}

function resolvedIn(city: string, state: string): GeocodeQueryResult {
  return {
    kind: "resolved",
    coordinates: { lat: 39.6423, lon: -74.1815 },
    address: { city, state, country_code: "us" },
  };
}

function createStore(): CoordinateStore {
  return createCoordinateStore();
}

// Records every query so ordering, deduplication and the retry chain are all
// observable, and lets each test script a per-query answer.
function createGeocoder(answers: Record<string, GeocodeQueryResult>) {
  const queries: string[] = [];

  return {
    queries,
    geocoder: {
      async geocode(query: string): Promise<GeocodeQueryResult> {
        queries.push(query);

        return answers[query] ?? { kind: "no-result" };
      },
      async stop() {},
    },
  };
}

describe("collectGeocodeTargets", () => {
  it("dedupes by address so a replayed room is one geocode, not many", () => {
    const targets = collectGeocodeTargets(
      [
        createEvent(SAND_BAR, "2026-08-10T23:00:00Z"),
        createEvent(SAND_BAR, "2026-08-17T23:00:00Z"),
        createEvent(
          "Sand Bar, 1 Bay Ave, Beach Haven, NJ",
          "2026-08-24T23:00:00Z",
        ),
      ],
      NOW,
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      key: "1 Bay Ave, Beach Haven, NJ",
      eventCount: 3,
    });
  });

  it("orders by soonest upcoming event so a cold backfill degrades gracefully", () => {
    const targets = collectGeocodeTargets(
      [
        createEvent(WONDER_BAR, "2026-09-01T23:00:00Z"),
        createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z"),
        createEvent(SAND_BAR, "2026-08-20T23:00:00Z"),
        // A second, later date for the soonest venue must not push it back.
        createEvent(SHIP_BOTTOM, "2026-10-01T23:00:00Z"),
      ],
      NOW,
    );

    expect(targets.map((target) => target.key)).toEqual([
      "100 Ocean Ave, Ship Bottom, NJ",
      "1 Bay Ave, Beach Haven, NJ",
      "1213 Ocean Ave, Asbury Park, NJ",
    ]);
  });

  it("drops addresses whose events are all in the past", () => {
    const targets = collectGeocodeTargets(
      [
        createEvent(SHIP_BOTTOM, "2026-07-01T23:00:00Z"),
        createEvent(SAND_BAR, "2026-08-20T23:00:00Z"),
      ],
      NOW,
    );

    expect(targets.map((target) => target.key)).toEqual([
      "1 Bay Ave, Beach Haven, NJ",
    ]);
  });

  // A show that started an hour ago is the soonest thing a visitor could be
  // looking for, so it stays in scope and sorts first.
  it("keeps an in-progress event and prioritizes it", () => {
    const targets = collectGeocodeTargets(
      [
        createEvent(SAND_BAR, "2026-08-05T23:00:00Z"),
        createEvent(SHIP_BOTTOM, "2026-08-03T11:00:00Z"),
      ],
      NOW,
    );

    expect(targets.map((target) => target.key)).toEqual([
      "100 Ocean Ave, Ship Bottom, NJ",
      "1 Bay Ave, Beach Haven, NJ",
    ]);
  });

  it("skips events with no location at all", () => {
    expect(
      collectGeocodeTargets(
        [
          {
            title: "Private booking",
            start: dayjs("2026-08-20T23:00:00Z"),
            end: dayjs("2026-08-21T02:00:00Z"),
          },
        ],
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("coordinate decoration job", () => {
  it("stores validated coordinates keyed by the normalized address", async () => {
    const store = createStore();
    const { geocoder, queries } = createGeocoder({
      "100 Ocean Ave, Ship Bottom, NJ": resolvedIn("Ship Bottom", "New Jersey"),
    });
    const job = createGeocodeDecorationJob({
      logger: createLogger(),
      store,
      geocoder,
      now: () => NOW,
    });

    const summary = await job.run([
      createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z"),
    ]);

    expect(summary).toMatchObject({ queued: 1, resolved: 1 });
    expect(queries).toEqual(["100 Ocean Ave, Ship Bottom, NJ"]);
    expect(store.get("100 Ocean Ave, Ship Bottom, NJ")).toMatchObject({
      status: "resolved",
      coordinates: { lat: 39.6423, lon: -74.1815 },
    });
  });

  // Steady state. The point of the whole design.
  it("makes no requests when every address is already resolved", async () => {
    const store = createStore();

    store.set(
      "100 Ocean Ave, Ship Bottom, NJ",
      buildCoordinateRecord({
        status: "resolved",
        coordinates: { lat: 39.6423, lon: -74.1815 },
        attemptedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const { geocoder, queries } = createGeocoder({});
    const job = createGeocodeDecorationJob({
      logger: createLogger(),
      store,
      geocoder,
      now: () => NOW,
    });

    const summary = await job.run([
      createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z"),
    ]);

    expect(summary).toMatchObject({ addresses: 1, queued: 0 });
    expect(queries).toEqual([]);
  });

  // A changed address string is a natural cache miss; nothing else has to detect
  // the change.
  it("re-geocodes when the street address changes but not when only the venue name does", async () => {
    const store = createStore();

    store.set(
      "100 Ocean Ave, Ship Bottom, NJ",
      buildCoordinateRecord({
        status: "resolved",
        coordinates: { lat: 39.6423, lon: -74.1815 },
        attemptedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const { geocoder, queries } = createGeocoder({
      "200 Ocean Ave, Ship Bottom, NJ": resolvedIn("Ship Bottom", "New Jersey"),
    });
    const job = createGeocodeDecorationJob({
      logger: createLogger(),
      store,
      geocoder,
      now: () => NOW,
    });

    await job.run([
      createEvent(
        "Boardwalk, 100 Ocean Ave, Ship Bottom, NJ",
        "2026-08-05T23:00:00Z",
      ),
      createEvent(
        "The Boardwalk, 200 Ocean Ave, Ship Bottom, NJ",
        "2026-08-06T23:00:00Z",
      ),
    ]);

    expect(queries).toEqual(["200 Ocean Ave, Ship Bottom, NJ"]);
  });

  it("falls back to the raw location when the normalized query finds nothing", async () => {
    const store = createStore();
    const { geocoder, queries } = createGeocoder({
      [SHIP_BOTTOM]: resolvedIn("Ship Bottom", "New Jersey"),
    });
    const job = createGeocodeDecorationJob({
      logger: createLogger(),
      store,
      geocoder,
      now: () => NOW,
    });

    await job.run([createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z")]);

    expect(queries).toEqual(["100 Ocean Ave, Ship Bottom, NJ", SHIP_BOTTOM]);
    expect(store.get("100 Ocean Ave, Ship Bottom, NJ")).toMatchObject({
      status: "resolved",
    });
  });

  // Normalization was a no-op, so the raw query is the same string. Paying for it
  // twice buys nothing.
  it("does not repeat an identical query as the raw fallback", async () => {
    const store = createStore();
    const { geocoder, queries } = createGeocoder({});
    const job = createGeocodeDecorationJob({
      logger: createLogger(),
      store,
      geocoder,
      now: () => NOW,
    });

    await job.run([
      createEvent("The Stone Pony, Asbury Park, NJ", "2026-08-05T23:00:00Z"),
    ]);

    expect(queries).toEqual(["The Stone Pony, Asbury Park, NJ"]);
  });

  it("records an unresolvable address so it stops re-entering the queue", async () => {
    const store = createStore();
    const logger = createLogger();
    const { geocoder, queries } = createGeocoder({});
    const job = createGeocodeDecorationJob({
      logger,
      store,
      geocoder,
      now: () => NOW,
    });
    const events = [createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z")];

    const first = await job.run(events);
    const second = await job.run(events);

    expect(first).toMatchObject({ unresolvable: 1 });
    expect(second).toMatchObject({ queued: 0 });
    // Two round trips on the first run, none on the second.
    expect(queries).toHaveLength(2);
    expect(store.get("100 Ocean Ave, Ship Bottom, NJ")).toMatchObject({
      status: "unresolvable",
      coordinates: null,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "100 Ocean Ave, Ship Bottom, NJ",
        status: "unresolvable",
      }),
      "Coordinates unavailable for a venue",
    );
  });

  // A fresh negative stays cached, otherwise a dead address would re-enter the
  // queue on every 30-minute refresh.
  it("does not re-query a negative that is still fresh", async () => {
    const store = createStore();

    store.set(
      "100 Ocean Ave, Ship Bottom, NJ",
      buildCoordinateRecord({
        status: "unresolvable",
        attemptedAt: NOW.subtract(2, "day").toISOString(),
      }),
    );

    const { geocoder, queries } = createGeocoder({
      "100 Ocean Ave, Ship Bottom, NJ": resolvedIn("Ship Bottom", "New Jersey"),
    });
    const job = createGeocodeDecorationJob({
      logger: createLogger(),
      store,
      geocoder,
      now: () => NOW,
    });

    await job.run([createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z")]);

    expect(queries).toEqual([]);
  });

  // The process may run for months, so a failure cannot be permanent — a venue
  // OSM did not know about last week has to get another look without a restart.
  it("retries a stored negative once it is stale enough", async () => {
    const store = createStore();

    store.set(
      "100 Ocean Ave, Ship Bottom, NJ",
      buildCoordinateRecord({
        status: "unresolvable",
        attemptedAt: NOW.subtract(8, "day").toISOString(),
      }),
    );

    const { geocoder, queries } = createGeocoder({
      "100 Ocean Ave, Ship Bottom, NJ": resolvedIn("Ship Bottom", "New Jersey"),
    });
    const job = createGeocodeDecorationJob({
      logger: createLogger(),
      store,
      geocoder,
      now: () => NOW,
    });

    await job.run([createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z")]);

    expect(queries).toEqual(["100 Ocean Ave, Ship Bottom, NJ"]);
    expect(store.get("100 Ocean Ave, Ship Bottom, NJ")?.status).toBe(
      "resolved",
    );
  });

  it("leaves a fresh negative alone", async () => {
    const store = createStore();

    store.set(
      "100 Ocean Ave, Ship Bottom, NJ",
      buildCoordinateRecord({
        status: "unresolvable",
        attemptedAt: NOW.subtract(2, "day").toISOString(),
      }),
    );

    const { geocoder, queries } = createGeocoder({});
    const job = createGeocodeDecorationJob({
      logger: createLogger(),
      store,
      geocoder,
      now: () => NOW,
    });

    await job.run([createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z")]);

    expect(queries).toEqual([]);
  });

  // A confident result in the wrong town is worse than no pin, so it is stored as
  // a rejection rather than as coordinates.
  it("rejects and stores null coordinates when the result is in the wrong place", async () => {
    const store = createStore();
    const logger = createLogger();
    const { geocoder } = createGeocoder({
      "100 Ocean Ave, Ship Bottom, NJ": resolvedIn("Asbury Park", "New Jersey"),
      [SHIP_BOTTOM]: resolvedIn("Asbury Park", "New Jersey"),
    });
    const job = createGeocodeDecorationJob({
      logger,
      store,
      geocoder,
      now: () => NOW,
    });

    const summary = await job.run([
      createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z"),
    ]);

    expect(summary).toMatchObject({ rejected: 1, resolved: 0 });
    expect(store.get("100 Ocean Ave, Ship Bottom, NJ")).toMatchObject({
      status: "rejected",
      coordinates: null,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected" }),
      "Coordinates unavailable for a venue",
    );
  });

  it("does not query an address with no parseable city and state", async () => {
    const store = createStore();
    const { geocoder, queries } = createGeocoder({});
    const job = createGeocodeDecorationJob({
      logger: createLogger(),
      store,
      geocoder,
      now: () => NOW,
    });

    const summary = await job.run([createEvent("TBD", "2026-08-05T23:00:00Z")]);

    expect(queries).toEqual([]);
    expect(summary).toMatchObject({ unresolvable: 1 });
    expect(store.get("TBD")).toMatchObject({
      status: "unresolvable",
      reason: "no city and state could be parsed from the location",
    });
  });

  // A 429 or a timeout has not ruled the address out. Caching it as a negative
  // would hide a real venue for a week.
  it("leaves a transient failure uncached and aborts after repeated failures", async () => {
    const store = createStore();
    const logger = createLogger();
    const { geocoder, queries } = createGeocoder({
      "100 Ocean Ave, Ship Bottom, NJ": {
        kind: "failed",
        reason: "http 429",
        failure: "transient",
      },
      "1 Bay Ave, Beach Haven, NJ": {
        kind: "failed",
        reason: "timeout",
        failure: "transient",
      },
      "1213 Ocean Ave, Asbury Park, NJ": resolvedIn(
        "Asbury Park",
        "New Jersey",
      ),
    });
    const job = createGeocodeDecorationJob({
      logger,
      store,
      geocoder,
      now: () => NOW,
    });

    const summary = await job.run([
      createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z"),
      createEvent(SAND_BAR, "2026-08-06T23:00:00Z"),
      createEvent(WONDER_BAR, "2026-08-07T23:00:00Z"),
    ]);

    expect(summary).toMatchObject({ queued: 3, failed: 2, aborted: true });
    // The third venue was never attempted.
    expect(queries).toEqual([
      "100 Ocean Ave, Ship Bottom, NJ",
      "1 Bay Ave, Beach Haven, NJ",
    ]);
    expect(store.size()).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ aborted: true }),
      "Coordinate decoration aborted after repeated geocoder failures",
    );
  });

  // The mirror of the test above, and the more dangerous case. A deterministic
  // failure repeats identically forever, so leaving it uncached re-queries it on
  // every 30-minute refresh — 48 requests a day against a provider that blocks
  // IPs for exactly that.
  it("caches a deterministic failure so it is not re-queried every refresh", async () => {
    const store = createStore();
    const { geocoder, queries } = createGeocoder({
      "100 Ocean Ave, Ship Bottom, NJ": {
        kind: "failed",
        reason: "http 400: bad request",
        failure: "address",
      },
    });
    const job = createGeocodeDecorationJob({
      logger: createLogger(),
      store,
      geocoder,
      now: () => NOW,
    });
    const events = [createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z")];

    const first = await job.run(events);

    expect(first).toMatchObject({ unresolvable: 1, aborted: false });
    expect(store.get("100 Ocean Ave, Ship Bottom, NJ")).toMatchObject({
      status: "unresolvable",
      coordinates: null,
      reason: "http 400: bad request",
    });

    const spentOnFirstRun = queries.length;

    // Four more refresh cycles, all inside the negative retry window.
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await job.run(events);
    }

    expect(queries).toHaveLength(spentOnFirstRun);
  });

  // 403 is Nominatim's answer to a blocked IP. It says nothing about the address,
  // so recording it as a negative would blank every venue for a week over a block
  // that may lift in minutes — strictly worse than the re-query loop that caching
  // deterministic failures was meant to close.
  it("does not blame the address when the provider refuses us", async () => {
    const store = createStore();
    const blocked: GeocodeQueryResult = {
      kind: "failed",
      reason: "http 403: blocked",
      failure: "provider",
    };
    const { geocoder, queries } = createGeocoder({
      "100 Ocean Ave, Ship Bottom, NJ": blocked,
      "1 Bay Ave, Beach Haven, NJ": blocked,
      "1213 Ocean Ave, Asbury Park, NJ": blocked,
    });
    const job = createGeocodeDecorationJob({
      logger: createLogger(),
      store,
      geocoder,
      now: () => NOW,
    });

    const summary = await job.run([
      createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z"),
      createEvent(SAND_BAR, "2026-08-06T23:00:00Z"),
      createEvent(WONDER_BAR, "2026-08-07T23:00:00Z"),
    ]);

    // Nothing cached, so the next refresh retries rather than waiting a week.
    expect(store.size()).toBe(0);
    // And the run gives up early instead of working down the queue collecting
    // the same refusal.
    expect(summary).toMatchObject({ failed: 2, aborted: true });
    expect(queries).toHaveLength(2);
  });

  // A malformed query for one venue is not the provider failing, so it must not
  // count toward the abort that stops the rest of the queue. Note both failures
  // here are address-scoped 400s — a provider-scoped refusal must still abort,
  // which the test above covers.
  it("does not let a deterministic failure abort the run", async () => {
    const store = createStore();
    const { geocoder } = createGeocoder({
      "100 Ocean Ave, Ship Bottom, NJ": {
        kind: "failed",
        reason: "http 400: bad request",
        failure: "address",
      },
      "1 Bay Ave, Beach Haven, NJ": {
        kind: "failed",
        reason: "http 400: bad request",
        failure: "address",
      },
      "1213 Ocean Ave, Asbury Park, NJ": resolvedIn(
        "Asbury Park",
        "New Jersey",
      ),
    });
    const job = createGeocodeDecorationJob({
      logger: createLogger(),
      store,
      geocoder,
      now: () => NOW,
    });

    const summary = await job.run([
      createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z"),
      createEvent(SAND_BAR, "2026-08-06T23:00:00Z"),
      createEvent(WONDER_BAR, "2026-08-07T23:00:00Z"),
    ]);

    // The third venue is still reached and resolved.
    expect(summary).toMatchObject({
      unresolvable: 2,
      resolved: 1,
      failed: 0,
      aborted: false,
    });
  });

  it("skips an overlapping run instead of stacking two backfills", async () => {
    const store = createStore();
    const logger = createLogger();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const job = createGeocodeDecorationJob({
      logger,
      store,
      geocoder: {
        async geocode() {
          await gate;

          return resolvedIn("Ship Bottom", "New Jersey");
        },
        async stop() {},
      },
      now: () => NOW,
    });
    const events = [createEvent(SHIP_BOTTOM, "2026-08-05T23:00:00Z")];

    const first = job.run(events);
    const second = await job.run(events);

    expect(second).toMatchObject({ skipped: true });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      "Coordinate decoration skipped because the previous run is still going",
    );

    release();
    expect(await first).toMatchObject({ resolved: 1, skipped: false });
  });
});
