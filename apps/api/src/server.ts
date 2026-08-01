import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { startCalendarCacheScheduler } from "./calendar/calendar.cache.js";
import { registerCalendarRoutes } from "./calendar/calendar.routes.js";
import { ENV } from "./env.js";
import { startHappyHourCacheScheduler } from "./happy-hour/happy-hour.cache.js";
import { registerHappyHourRoutes } from "./happy-hour/happy-hour.routes.js";
import { startIndexNowScheduler } from "./index-now/index-now.scheduler.js";
import { registerIndexNowRoutes } from "./index-now/index-now.routes.js";
import { registerNixleRoutes } from "./nixle/nixle.routes.js";

export async function buildServer() {
  const server = Fastify({
    logger: true,
  });

  await server.register(sensible);

  if (ENV.NODE_ENV !== "test") {
    // Started before the calendar scheduler so the first warm cycle seeds
    // IndexNow fingerprints instead of looking like a calendar full of changes.
    const stopIndexNowScheduler = startIndexNowScheduler(server.log);
    const stopCalendarCacheScheduler = startCalendarCacheScheduler(server.log);
    const stopHappyHourCacheScheduler = startHappyHourCacheScheduler(
      server.log,
    );

    server.addHook("onClose", async () => {
      stopIndexNowScheduler();
      await stopCalendarCacheScheduler();
      await stopHappyHourCacheScheduler();
    });
  }

  server.get("/health", async () => ({
    ok: true,
  }));

  await registerCalendarRoutes(server);
  await registerHappyHourRoutes(server);
  await registerIndexNowRoutes(server);
  await registerNixleRoutes(server);

  return server;
}
