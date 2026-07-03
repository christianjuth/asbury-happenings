import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { startCalendarCacheScheduler } from "./calendar/calendar.cache.js";
import { registerCalendarRoutes } from "./calendar/calendar.routes.js";
import { ENV } from "./env.js";

export async function buildServer() {
  const server = Fastify({
    logger: true
  });

  await server.register(sensible);

  if (ENV.NODE_ENV !== "test") {
    const stopCalendarCacheScheduler = startCalendarCacheScheduler(server.log);

    server.addHook("onClose", async () => {
      stopCalendarCacheScheduler();
    });
  }

  server.get("/health", async () => ({
    ok: true
  }));

  await registerCalendarRoutes(server);

  return server;
}
