import type { FastifyInstance } from "fastify";

import {
  coordinateOverrideEntries,
  findCoordinateOverride,
} from "./geocode.overrides.js";
import { getCoordinateStore } from "./geocode.store.js";

// There is no admin UI, and the only override path is a table in the source, so
// an address that never resolves must not be invisible. This is the read-only
// view of everything the job gave up on, plus the pins that are set by hand and
// so never reach the job at all.
export async function registerGeocodeRoutes(server: FastifyInstance) {
  server.get("/debug/geocode", async () => {
    const store = getCoordinateStore();
    const entries = store.entries();
    // An overridden address is resolved for every reader, so a store record left
    // behind from before the row was added would report a problem that no longer
    // exists. The store's own counts stay honest about what the geocoder said.
    const unresolved = entries.filter(
      ([address, record]) =>
        record.status !== "resolved" && !findCoordinateOverride(address),
    );

    return {
      service: "geocode",
      store: {
        addresses: entries.length,
        resolved: entries.filter(([, record]) => record.status === "resolved")
          .length,
      },
      overrides: coordinateOverrideEntries().map(([address, override]) => ({
        address,
        coordinates: override.coordinates,
        reason: override.reason,
      })),
      unresolved: unresolved.map(([address, record]) => ({
        address,
        status: record.status,
        attemptedAt: record.attemptedAt,
        reason: record.reason ?? null,
      })),
    };
  });
}
