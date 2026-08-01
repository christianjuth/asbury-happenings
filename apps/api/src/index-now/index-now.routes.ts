import type { FastifyInstance } from "fastify";

import { getCachedCalendarStatus } from "../calendar/calendar.cache.js";
import { SAMANTHA_DRESS_SOURCE } from "../calendar/config/samantha-dress.js";
import { ENV } from "../env.js";

export async function registerIndexNowRoutes(server: FastifyInstance) {
  server.get("/debug/index-now", async () => {
    const calendar = getCachedCalendarStatus(SAMANTHA_DRESS_SOURCE);

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
