import type { FastifyInstance } from "fastify";
import {
  getCachedCalendarDebugText,
  getCachedCalendarFeed,
  getCachedCalendarStatusDebugText,
  getCachedCalendarStatusFeed,
} from "./calendar.cache.js";
import { CALENDAR_SOURCES, getCalendarSource } from "./calendar.config.js";
import { applyCalendarPreflightHeaders } from "./calendar.cors.js";

const STATUS_CALENDAR_ID = "status";
const STATUS_CALENDAR = {
  id: STATUS_CALENDAR_ID,
  name: "Calendar Status",
  path: `/calendar/${STATUS_CALENDAR_ID}.ics`,
};

export async function registerCalendarRoutes(server: FastifyInstance) {
  server.get("/calendar", async () => ({
    calendars: [
      ...CALENDAR_SOURCES.map((source) => ({
        id: source.id,
        name: source.name,
        path: `/calendar/${source.id}.ics`,
      })),
      STATUS_CALENDAR,
    ],
  }));

  server.get<{
    Params: { calendarId: string };
    Querystring: { debug?: string; filter?: string | string[] };
  }>("/calendar/:calendarId.ics", async (request, reply) => {
    if (request.params.calendarId === STATUS_CALENDAR_ID) {
      if (isDebugRequest(request.query.debug)) {
        return reply
          .type("text/plain; charset=utf-8")
          .send(getCachedCalendarStatusDebugText());
      }

      return reply
        .header("cache-control", "public, max-age=300")
        .type("text/calendar; charset=utf-8")
        .send(getCachedCalendarStatusFeed());
    }

    const config = getCalendarSource(request.params.calendarId);

    if (!config) {
      throw server.httpErrors.notFound("Unknown calendar");
    }

    if (isDebugRequest(request.query.debug)) {
      const debugText = getCachedCalendarDebugText(
        config,
        request.query.filter,
      );

      return reply.type("text/plain; charset=utf-8").send(debugText);
    }

    const feed = getCachedCalendarFeed(config, request.query.filter);

    if (!feed) {
      return reply
        .code(503)
        .type("text/plain; charset=utf-8")
        .send("Calendar cache warming");
    }

    return reply
      .header("cache-control", "public, max-age=300")
      .type("text/calendar; charset=utf-8")
      .send(feed);
  });

  server.options<{ Params: { calendarId: string } }>(
    "/calendar/:calendarId.ics",
    async (request, reply) => {
      if (request.params.calendarId !== STATUS_CALENDAR_ID) {
        const config = getCalendarSource(request.params.calendarId);

        if (!config) {
          throw server.httpErrors.notFound("Unknown calendar");
        }
      }

      return applyCalendarPreflightHeaders(reply).code(204).send();
    },
  );
}

function isDebugRequest(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "text";
}
