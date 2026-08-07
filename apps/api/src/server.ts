import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { startCalendarCacheScheduler } from "./calendar/calendar.cache.js";
import { registerCalendarRoutes } from "./calendar/calendar.routes.js";
import { ENV } from "./env.js";
import { startHappyHourCacheScheduler } from "./happy-hour/happy-hour.cache.js";
import { registerHappyHourRoutes } from "./happy-hour/happy-hour.routes.js";
import { registerGeocodeRoutes } from "./geocode/geocode.routes.js";
import { startGeocodeScheduler } from "./geocode/geocode.scheduler.js";
import { startIndexNowScheduler } from "./index-now/index-now.scheduler.js";
import { registerIndexNowRoutes } from "./index-now/index-now.routes.js";
import { registerNixleRoutes } from "./nixle/nixle.routes.js";
import { registerSamanthaDressRoutes } from "./samantha-dress/samantha-dress.routes.js";

export async function buildServer() {
  const server = Fastify({
    logger: true,
  });

  await server.register(sensible);

  if (ENV.NODE_ENV !== "test") {
    // Started before the calendar scheduler so the first warm cycle seeds
    // IndexNow fingerprints instead of looking like a calendar full of changes.
    const stopIndexNowScheduler = startIndexNowScheduler(server.log);
    // Also started before the calendar scheduler, so the first warm cycle
    // already has a listener to trigger coordinate decoration.
    const stopGeocodeScheduler = startGeocodeScheduler(server.log);
    const stopCalendarCacheScheduler = startCalendarCacheScheduler(server.log);
    const stopHappyHourCacheScheduler = startHappyHourCacheScheduler(
      server.log,
    );

    server.addHook("onClose", async () => {
      stopIndexNowScheduler();
      await stopGeocodeScheduler();
      await stopCalendarCacheScheduler();
      await stopHappyHourCacheScheduler();
    });
  }

  server.get("/health", async () => ({
    ok: true,
  }));

  await registerCalendarRoutes(server);
  await registerGeocodeRoutes(server);
  await registerHappyHourRoutes(server);
  await registerIndexNowRoutes(server);
  await registerNixleRoutes(server);
  await registerSamanthaDressRoutes(server);

  return server;
}
