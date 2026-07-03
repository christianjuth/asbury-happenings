import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildCalendarFeed } from "./calendar.service.js";

const querySchema = z.object({
  url: z.string().url()
});

export async function registerCalendarRoutes(server: FastifyInstance) {
  server.get("/calendar/webpage.ics", async (request, reply) => {
    const query = querySchema.safeParse(request.query);

    if (!query.success) {
      throw server.httpErrors.badRequest("Expected query param: url");
    }

    const feed = await buildCalendarFeed(query.data.url);

    return reply
      .header("cache-control", "public, max-age=300")
      .type("text/calendar; charset=utf-8")
      .send(feed);
  });
}
