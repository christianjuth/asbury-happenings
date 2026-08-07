import { describe, expect, it } from "vitest";

import {
  buildCoordinateRecord,
  clearCoordinateStore,
  createCoordinateStore,
  getCoordinateStore,
} from "../src/geocode/geocode.store.js";

const SHIP_BOTTOM = "100 Ocean Ave, Ship Bottom, NJ";

describe("coordinate store", () => {
  it("starts empty", () => {
    expect(createCoordinateStore().size()).toBe(0);
  });

  it("reads back what it wrote", () => {
    const store = createCoordinateStore();

    store.set(
      SHIP_BOTTOM,
      buildCoordinateRecord({
        status: "resolved",
        coordinates: { lat: 39.6423, lon: -74.1815 },
        attemptedAt: "2026-08-02T21:14:58.000Z",
      }),
    );

    expect(store.get(SHIP_BOTTOM)).toEqual({
      status: "resolved",
      coordinates: { lat: 39.6423, lon: -74.1815 },
      attemptedAt: "2026-08-02T21:14:58.000Z",
      reason: undefined,
    });
  });

  // The reason a store exists at all now that nothing is written to disk: a
  // failure is remembered, so the 30-minute calendar refresh cannot re-ask the
  // geocoder about an address that already failed. How long it stays remembered
  // is the job's business (see NEGATIVE_RETRY_MS), not the store's.
  it("remembers a negative answer so it is not re-queried", () => {
    const store = createCoordinateStore();

    store.set(
      "1 Bay Ave, Beach Haven, NJ",
      buildCoordinateRecord({
        status: "unresolvable",
        attemptedAt: "2026-08-02T21:14:58.000Z",
        reason: "no results",
      }),
    );

    expect(store.get("1 Bay Ave, Beach Haven, NJ")).toMatchObject({
      status: "unresolvable",
      coordinates: null,
      reason: "no results",
    });
  });

  it("lists entries sorted by address", () => {
    const store = createCoordinateStore();
    const record = buildCoordinateRecord({
      status: "resolved",
      coordinates: { lat: 39.6959, lon: -74.2593 },
      attemptedAt: "2026-08-02T21:14:58.000Z",
    });

    store.set("9 Main St, Manahawkin, NJ", record);
    store.set("1 Bay Ave, Beach Haven, NJ", record);

    expect(store.entries().map(([address]) => address)).toEqual([
      "1 Bay Ave, Beach Haven, NJ",
      "9 Main St, Manahawkin, NJ",
    ]);
  });

  // The decoration job writes it and the Samantha Dress service reads it, so
  // they have to be looking at the same map.
  it("shares one store across the process until it is cleared", () => {
    getCoordinateStore().set(
      SHIP_BOTTOM,
      buildCoordinateRecord({
        status: "resolved",
        coordinates: { lat: 39.6423, lon: -74.1815 },
        attemptedAt: "2026-08-02T21:14:58.000Z",
      }),
    );

    expect(getCoordinateStore().get(SHIP_BOTTOM)?.status).toBe("resolved");

    // Standing in for a deploy: coordinates are deliberately not persisted, so
    // the next process starts cold and backfills again.
    clearCoordinateStore();

    expect(getCoordinateStore().size()).toBe(0);
  });
});
