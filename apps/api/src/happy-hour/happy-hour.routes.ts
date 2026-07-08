import type { FastifyInstance } from "fastify";

import { HAPPY_HOUR_SOURCE } from "./happy-hour.config.js";
import {
  getCachedHappyHourDebugText,
  getCachedHappyHourFeed,
} from "./happy-hour.cache.js";

export async function registerHappyHourRoutes(server: FastifyInstance) {
  server.get("/happy-hours", async () => ({
    calendars: [
      {
        id: HAPPY_HOUR_SOURCE.id,
        name: HAPPY_HOUR_SOURCE.name,
        path: "/happy-hours/asbury-park.ics",
      },
    ],
  }));

  server.get<{ Querystring: { debug?: string; filter?: string | string[] } }>(
    "/happy-hours/asbury-park.ics",
    async (request, reply) => {
      if (isDebugRequest(request.query.debug)) {
        const debugText = getCachedHappyHourDebugText(
          HAPPY_HOUR_SOURCE,
          request.query.filter,
        );

        return reply.type("text/plain; charset=utf-8").send(debugText);
      }

      const feed = getCachedHappyHourFeed(
        HAPPY_HOUR_SOURCE,
        request.query.filter,
      );

      if (!feed) {
        return reply
          .code(503)
          .type("text/plain; charset=utf-8")
          .send("Happy hour cache warming");
      }

      return reply
        .header("cache-control", "public, max-age=300")
        .type("text/calendar; charset=utf-8")
        .send(feed);
    },
  );
}

function isDebugRequest(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "text";
}
