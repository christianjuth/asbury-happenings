import type { FastifyReply } from "fastify";

export function applyCalendarPreflightHeaders(
  reply: FastifyReply,
): FastifyReply {
  return reply
    .header("access-control-allow-methods", "GET, OPTIONS")
    .header("access-control-allow-headers", "accept, content-type")
    .header("access-control-max-age", "3600");
}
