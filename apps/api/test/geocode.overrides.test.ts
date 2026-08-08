import { describe, expect, it, vi } from "vitest";

import dayjs from "../src/calendar/calendar.dates.js";
import { lookupCoordinates } from "../src/geocode/geocode.lookup.js";
import {
  COORDINATE_OVERRIDES,
  findCoordinateOverride,
} from "../src/geocode/geocode.overrides.js";
import { createGeocodeDecorationJob } from "../src/geocode/geocode.service.js";
import {
  buildCoordinateRecord,
  createCoordinateStore,
} from "../src/geocode/geocode.store.js";

const LONG_BEACH = "6805 Long Beach Blvd, Long Beach, NJ 08008, USA";
const LONG_BEACH_COORDINATES = { lat: 39.61583, lon: -74.19869 };

describe("coordinate override table", () => {
  // The table is hand-edited and never validated by a provider, so the rows are
  // checked here: a typo'd sign or a transposed pair puts a confident pin in the
  // wrong hemisphere, which is exactly the failure the table exists to prevent.
  it("holds rows that are addressable and in range", () => {
    expect(COORDINATE_OVERRIDES.length).toBeGreaterThan(0);

    for (const override of COORDINATE_OVERRIDES) {
      expect(override.address.trim()).not.toBe("");
      expect(override.reason.trim()).not.toBe("");
      expect(override.coordinates.lat).toBeGreaterThanOrEqual(-90);
      expect(override.coordinates.lat).toBeLessThanOrEqual(90);
      expect(override.coordinates.lon).toBeGreaterThanOrEqual(-180);
      expect(override.coordinates.lon).toBeLessThanOrEqual(180);

      // Each row has to be reachable by its own address, which also rules out two
      // rows normalizing onto one key and silently shadowing each other.
      expect(findCoordinateOverride(override.address)).toBe(override);
    }
  });

  it("pins the address it was written for", () => {
    expect(findCoordinateOverride(LONG_BEACH)?.coordinates).toEqual(
      LONG_BEACH_COORDINATES,
    );
  });

  // The same normalization the store is keyed by, so the row survives a venue
  // rename and the calendar's inconsistent trailing country.
  it.each([
    [
      "a leading venue name",
      "The Ketch, 6805 Long Beach Blvd, Long Beach, NJ 08008, USA",
    ],
    ["no trailing country", "6805 Long Beach Blvd, Long Beach, NJ 08008"],
    [
      "different case and spacing",
      "6805  long beach blvd,  Long Beach,  NJ 08008, usa",
    ],
  ])("matches the row despite %s", (_label, location) => {
    expect(findCoordinateOverride(location)?.coordinates).toEqual(
      LONG_BEACH_COORDINATES,
    );
  });

  // Loose matching would be worse than no table: these feed pins on a map, and a
  // neighbouring town on the same boulevard is a different place.
  it.each([
    "6805 Long Beach Blvd, Beach Haven, NJ 08008, USA",
    "6800 Long Beach Blvd, Long Beach, NJ 08008, USA",
    "Long Beach, NJ",
  ])("does not match %s", (location) => {
    expect(findCoordinateOverride(location)).toBeUndefined();
  });

  it("ignores an absent location", () => {
    expect(findCoordinateOverride(undefined)).toBeUndefined();
  });
});

describe("coordinate lookup with an override", () => {
  it("reports the hand-set coordinates with nothing in the store", () => {
    expect(
      lookupCoordinates(createCoordinateStore(), LONG_BEACH, { past: false }),
    ).toEqual({
      coordinates: LONG_BEACH_COORDINATES,
      status: "resolved",
      manual: true,
    });
  });

  // The reason the table is read before the store rather than seeded into it: an
  // address is listed because the geocoder's answer is wrong, and a wrong answer
  // that passed validation is stored `resolved` like any other.
  it("wins over a stored answer from the geocoder", () => {
    const store = createCoordinateStore();

    store.set(
      LONG_BEACH,
      buildCoordinateRecord({
        status: "resolved",
        coordinates: { lat: 39.5, lon: -74.3 },
        attemptedAt: "2026-08-02T21:14:58.000Z",
      }),
    );

    expect(lookupCoordinates(store, LONG_BEACH, { past: false })).toEqual({
      coordinates: LONG_BEACH_COORDINATES,
      status: "resolved",
      manual: true,
    });
  });

  it("wins over a stored rejection", () => {
    const store = createCoordinateStore();

    store.set(
      LONG_BEACH,
      buildCoordinateRecord({
        status: "rejected",
        attemptedAt: "2026-08-02T21:14:58.000Z",
        reason:
          "result localities ship-bottom do not include expected long-beach",
      }),
    );

    expect(lookupCoordinates(store, LONG_BEACH, { past: false })).toEqual({
      coordinates: LONG_BEACH_COORDINATES,
      status: "resolved",
      manual: true,
    });
  });

  // Past events are never queued, so they depend on a run having happened. A
  // hand-written coordinate does not.
  it("reports coordinates for a past event", () => {
    expect(
      lookupCoordinates(createCoordinateStore(), LONG_BEACH, { past: true }),
    ).toEqual({
      coordinates: LONG_BEACH_COORDINATES,
      status: "resolved",
      manual: true,
    });
  });

  it("leaves an address with no row to the normal path", () => {
    expect(
      lookupCoordinates(
        createCoordinateStore(),
        "100 Ocean Ave, Ship Bottom, NJ",
        { past: false },
      ),
    ).toEqual({ coordinates: null, status: "pending", manual: false });
  });
});

describe("coordinate decoration job with an override", () => {
  it("never asks the geocoder about an overridden address", async () => {
    const store = createCoordinateStore();
    const geocode = vi.fn();
    const job = createGeocodeDecorationJob({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      store,
      geocoder: { geocode, stop: async () => {} },
      now: () => dayjs("2026-08-03T12:00:00Z"),
    });

    const summary = await job.run([
      {
        title: `Show at ${LONG_BEACH}`,
        start: dayjs("2026-08-05T23:00:00Z"),
        end: dayjs("2026-08-06T02:00:00Z"),
        location: LONG_BEACH,
        address: LONG_BEACH,
      },
    ]);

    expect(summary).toMatchObject({ addresses: 1, queued: 0, resolved: 0 });
    expect(geocode).not.toHaveBeenCalled();
    // Configuration, not a cached answer. Writing it into the store would only
    // add a second copy that can disagree with the table.
    expect(store.size()).toBe(0);
  });
});
