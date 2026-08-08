import type { FastifyInstance } from "fastify";

import { ENV } from "../env.js";
import { getSamanthaDressEventStatus } from "../samantha-dress/samantha-dress.cache.js";
import { SAMANTHA_DRESS_SOURCE } from "../samantha-dress/samantha-dress.config.js";

export async function registerIndexNowRoutes(server: FastifyInstance) {
  server.get("/debug/index-now", async () => {
    const calendar = getSamanthaDressEventStatus();

    return {
      service: "index-now",
      enabled: Boolean(ENV.INDEXNOW_KEY),
      calendar: {
        id: SAMANTHA_DRESS_SOURCE.id,
        warm: calendar.warm,
        eventCount: calendar.eventCount,
      },
    };
  });
}
