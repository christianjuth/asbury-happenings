import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { startCalendarCacheScheduler } from "./calendar/calendar.cache.js";
import { registerCalendarRoutes } from "./calendar/calendar.routes.js";
import { ENV } from "./env.js";
import { startHappyHourCacheScheduler } from "./happy-hour/happy-hour.cache.js";
import { registerHappyHourRoutes } from "./happy-hour/happy-hour.routes.js";

export async function buildServer() {
  const server = Fastify({
    logger: true
  });

  await server.register(sensible);

  if (ENV.NODE_ENV !== "test") {
    const stopCalendarCacheScheduler = startCalendarCacheScheduler(server.log);
    const stopHappyHourCacheScheduler = startHappyHourCacheScheduler(server.log);

    server.addHook("onClose", async () => {
      await stopCalendarCacheScheduler();
      await stopHappyHourCacheScheduler();
    });
  }

  server.get("/health", async () => ({
    ok: true
  }));

  await registerCalendarRoutes(server);
  await registerHappyHourRoutes(server);

  return server;
}
