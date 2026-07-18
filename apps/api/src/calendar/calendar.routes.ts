import type { FastifyInstance, FastifyReply } from "fastify";
import {
  getCachedCalendarDebugText,
  getCachedCalendarFeed,
  getCachedCalendarStatusDebugText,
  getCachedCalendarStatusFeed,
} from "./calendar.cache.js";
import { CALENDAR_SOURCES, getCalendarSource } from "./calendar.config.js";
import type { CalendarSourceConfig } from "./calendar.service.js";

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

    applyCalendarCorsHeaders(request.headers.origin, config, reply);

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
      if (request.params.calendarId === STATUS_CALENDAR_ID) {
        return reply
          .header("access-control-allow-methods", "GET, OPTIONS")
          .header("access-control-allow-headers", "accept, content-type")
          .header("access-control-max-age", "3600")
          .code(204)
          .send();
      }

      const config = getCalendarSource(request.params.calendarId);

      if (!config) {
        throw server.httpErrors.notFound("Unknown calendar");
      }

      applyCalendarCorsHeaders(request.headers.origin, config, reply);

      return reply
        .header("access-control-allow-methods", "GET, OPTIONS")
        .header("access-control-allow-headers", "accept, content-type")
        .header("access-control-max-age", "3600")
        .code(204)
        .send();
    },
  );
}

function isDebugRequest(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "text";
}

function applyCalendarCorsHeaders(
  origin: string | undefined,
  config: CalendarSourceConfig,
  reply: FastifyReply,
): void {
  reply.header("vary", "Origin");

  if (origin && isOriginAllowed(origin, config.browserAllowedOrigins)) {
    reply.header("access-control-allow-origin", origin);
  }
}

function isOriginAllowed(
  origin: string,
  allowedOrigins: string[] | undefined,
): boolean {
  return (
    allowedOrigins?.some((pattern) => originMatchesPattern(origin, pattern)) ??
    false
  );
}

function originMatchesPattern(origin: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return origin === pattern;
  }

  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped.replace(/\\\*/g, "[^.]+")}$`);
  return regex.test(origin);
}
