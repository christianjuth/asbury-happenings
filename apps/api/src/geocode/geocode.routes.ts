import type { FastifyInstance } from "fastify";

import { getCoordinateStore } from "./geocode.store.js";

// There is no admin UI and no override path by design, but an address that never
// resolves must not be invisible. This is the read-only view of everything the
// job gave up on.
export async function registerGeocodeRoutes(server: FastifyInstance) {
  server.get("/debug/geocode", async () => {
    const store = getCoordinateStore();
    const entries = store.entries();
    const unresolved = entries.filter(
      ([, record]) => record.status !== "resolved",
    );

    return {
      service: "geocode",
      store: {
        addresses: entries.length,
        resolved: entries.length - unresolved.length,
      },
      unresolved: unresolved.map(([address, record]) => ({
        address,
        status: record.status,
        attemptedAt: record.attemptedAt,
        reason: record.reason ?? null,
      })),
    };
  });
}
