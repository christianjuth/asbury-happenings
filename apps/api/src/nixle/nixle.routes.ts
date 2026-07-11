import type { FastifyInstance } from "fastify";

import { getNixleRssFeed } from "./nixle.cache.js";
import { getNixleSource, NIXLE_SOURCES } from "./nixle.config.js";

export async function registerNixleRoutes(server: FastifyInstance) {
  server.get("/rss", async () => ({
    feeds: NIXLE_SOURCES.map((source) => ({
      id: source.id,
      name: source.name,
      path: source.path,
    })),
  }));

  server.get<{ Params: { feedId: string } }>(
    "/rss/:feedId.xml",
    async (request, reply) => {
      const source = getNixleSource(request.params.feedId);

      if (!source) {
        throw server.httpErrors.notFound("Unknown Nixle feed");
      }

      const rss = await getNixleRssFeed(source);

      return reply
        .header("cache-control", "public, max-age=300")
        .type("application/rss+xml; charset=utf-8")
        .send(rss);
    },
  );
}
