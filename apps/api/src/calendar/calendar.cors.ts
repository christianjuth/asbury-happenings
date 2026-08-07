import type { FastifyReply } from "fastify";

import type { CalendarSourceConfig } from "./calendar.types.js";

// Browser access to a calendar is governed by its own `browserAllowedOrigins`
// list. Shared by every route that serves a calendar source — the ICS feed and
// the Samantha Dress JSON service — so the two cannot drift apart on which
// origins they answer.
export function applyCalendarCorsHeaders(
  origin: string | undefined,
  config: CalendarSourceConfig,
  reply: FastifyReply,
): void {
  reply.header("vary", "Origin");

  if (origin && isOriginAllowed(origin, config.browserAllowedOrigins)) {
    reply.header("access-control-allow-origin", origin);
  }
}

export function applyCalendarPreflightHeaders(
  reply: FastifyReply,
): FastifyReply {
  return reply
    .header("access-control-allow-methods", "GET, OPTIONS")
    .header("access-control-allow-headers", "accept, content-type")
    .header("access-control-max-age", "3600");
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
