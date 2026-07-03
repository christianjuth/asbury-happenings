import type { FastifyInstance } from "fastify";
import { getCachedCalendarDebugText, getCachedCalendarFeed } from "./calendar.cache.js";
import { CALENDAR_SOURCES, getCalendarSource } from "./calendar.config.js";

export async function registerCalendarRoutes(server: FastifyInstance) {
  server.get("/calendar", async () => ({
    calendars: CALENDAR_SOURCES.map((source) => ({
      id: source.id,
      name: source.name,
      path: `/calendar/${source.id}.ics`
    }))
  }));

  server.get<{ Params: { calendarId: string }; Querystring: { debug?: string } }>(
    "/calendar/:calendarId.ics",
    async (request, reply) => {
      const config = getCalendarSource(request.params.calendarId);

      if (!config) {
        throw server.httpErrors.notFound("Unknown calendar");
      }

      if (isDebugRequest(request.query.debug)) {
        const debugText = getCachedCalendarDebugText(config);

        return reply.type("text/plain; charset=utf-8").send(debugText);
      }

      const feed = getCachedCalendarFeed(config);

      if (!feed) {
        return reply.code(503).type("text/plain; charset=utf-8").send("Calendar cache warming");
      }

      return reply
        .header("cache-control", "public, max-age=300")
        .type("text/calendar; charset=utf-8")
        .send(feed);
    }
  );
}

function isDebugRequest(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "text";
}
