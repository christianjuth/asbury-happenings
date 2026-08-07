import type { FastifyInstance } from "fastify";

import {
  applyCalendarCorsHeaders,
  applyCalendarPreflightHeaders,
} from "../calendar/calendar.cors.js";
import { SAMANTHA_DRESS_SOURCE } from "../calendar/config/samantha-dress.js";
import { getSamanthaDressSnapshot } from "./samantha-dress.service.js";

const EVENTS_PATH = "/samantha-dress/events";

// Its own namespace rather than another `/calendar/...` path, because this is
// where the Samantha Dress feed is headed: `/calendar/samantha-dress.ics` stays
// for backwards compatibility and is the one meant to be deprecated eventually.
// The other ICS calendars are not following — they keep the calendar routes as
// they are and get no JSON transport.
export async function registerSamanthaDressRoutes(server: FastifyInstance) {
  server.get(EVENTS_PATH, async (request, reply) => {
    applyCalendarCorsHeaders(
      request.headers.origin,
      SAMANTHA_DRESS_SOURCE,
      reply,
    );

    return reply
      .header("cache-control", "public, max-age=300")
      .type("application/json; charset=utf-8")
      .send(getSamanthaDressSnapshot());
  });

  server.options(EVENTS_PATH, async (request, reply) => {
    applyCalendarCorsHeaders(
      request.headers.origin,
      SAMANTHA_DRESS_SOURCE,
      reply,
    );

    return applyCalendarPreflightHeaders(reply).code(204).send();
  });
}
