import type { FastifyInstance } from "fastify";

import {
  applyCalendarCorsHeaders,
  applyCalendarPreflightHeaders,
} from "../calendar/calendar.cors.js";
import { getSamanthaDressDebugSnapshot } from "./samantha-dress.debug.js";
import { SAMANTHA_DRESS_SOURCE } from "./samantha-dress.config.js";
import { getSamanthaDressSnapshot } from "./samantha-dress.service.js";

const EVENTS_PATH = "/samantha-dress/events";

// Its own namespace rather than another `/calendar/...` path, because this is
// where the Samantha Dress feed is headed: `/calendar/samantha-dress.ics` stays
// for backwards compatibility and is the one meant to be deprecated eventually.
// The other ICS calendars are not following — they keep the calendar routes as
// they are and get no JSON transport.
export async function registerSamanthaDressRoutes(server: FastifyInstance) {
  server.get<{ Querystring: { debug?: string } }>(
    EVENTS_PATH,
    async (request, reply) => {
      applyCalendarCorsHeaders(
        request.headers.origin,
        SAMANTHA_DRESS_SOURCE,
        reply,
      );

      // Provenance for everything the published document resolved: the wall
      // clock the source carried, whether it was floating, and which zone
      // resolver branch fired. The published document carries conclusions only,
      // so without this a baked-in zone guess is invisible from the outside.
      // Uncached, because it exists to be read against the live feed.
      if (isDebugRequest(request.query.debug)) {
        return reply
          .header("cache-control", "no-store")
          .type("application/json; charset=utf-8")
          .send(getSamanthaDressDebugSnapshot());
      }

      return reply
        .header("cache-control", "public, max-age=300")
        .type("application/json; charset=utf-8")
        .send(getSamanthaDressSnapshot());
    },
  );

  server.options(EVENTS_PATH, async (request, reply) => {
    applyCalendarCorsHeaders(
      request.headers.origin,
      SAMANTHA_DRESS_SOURCE,
      reply,
    );

    return applyCalendarPreflightHeaders(reply).code(204).send();
  });
}

// Matches the calendar routes' debug flag so one habit works on both.
function isDebugRequest(value: string | undefined): boolean {
  return value === "1" || value === "true";
}
