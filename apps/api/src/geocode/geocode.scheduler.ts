import type { FastifyBaseLogger } from "fastify";

import { onCalendarRefresh } from "../calendar/calendar.cache.js";
import { SAMANTHA_DRESS_SOURCE } from "../calendar/config/samantha-dress.js";
import { getErrorDetails } from "../logging.js";
import { createGeocodeDecorationJob } from "./geocode.service.js";
import { getCoordinateStore } from "./geocode.store.js";

// Coordinate decoration runs as its own job off the back of each calendar
// refresh, never inside the fetch path. Events land in the cache first and
// unchanged; a slow or rate-limited geocoder can only delay pins, never event
// freshness. The job is deliberately not awaited here for the same reason.
export function startGeocodeScheduler(
  logger: FastifyBaseLogger,
): () => Promise<void> {
  const store = getCoordinateStore();
  const job = createGeocodeDecorationJob({
    logger,
    store,
    fallbackTimeZone: SAMANTHA_DRESS_SOURCE.timeZone,
  });

  const stopListening = onCalendarRefresh((config, events) => {
    if (config.id !== SAMANTHA_DRESS_SOURCE.id) {
      return;
    }

    void job.run(events).catch((error: unknown) => {
      logger.error(
        { calendarId: config.id, ...getErrorDetails(error) },
        "Coordinate decoration run threw unexpectedly",
      );
    });
  });

  logger.info(
    {
      calendarId: SAMANTHA_DRESS_SOURCE.id,
      storedAddresses: store.size(),
    },
    "Coordinate decoration enabled for Samantha Dress calendar refreshes",
  );

  return async () => {
    stopListening();
    await job.stop();
  };
}
