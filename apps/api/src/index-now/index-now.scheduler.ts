import type { FastifyBaseLogger } from "fastify";

import { onCalendarRefresh } from "../calendar/calendar.cache.js";
import { SAMANTHA_DRESS_SOURCE } from "../calendar/config/samantha-dress.js";
import { ENV } from "../env.js";
import { createIndexNowService } from "./index-now.service.js";

// Wires the IndexNow service to the calendar cache. The first successful warm
// only seeds fingerprints; every later warm submits only its changed events.
export function startIndexNowScheduler(logger: FastifyBaseLogger): () => void {
  const service = createIndexNowService({
    key: ENV.INDEXNOW_KEY,
    logger,
  });

  if (!service.enabled) {
    logger.info(
      { calendarId: SAMANTHA_DRESS_SOURCE.id },
      "IndexNow disabled because INDEXNOW_KEY is not configured",
    );

    return () => {};
  }

  let seeded = false;
  const stopListening = onCalendarRefresh((config, events) => {
    if (config.id !== SAMANTHA_DRESS_SOURCE.id) {
      return;
    }

    if (!seeded) {
      seeded = true;
      service.seed(events);
      return;
    }

    void service.submitCalendarDiff(events);
  });

  logger.info(
    { calendarId: SAMANTHA_DRESS_SOURCE.id },
    "IndexNow enabled for Samantha Dress calendar refreshes",
  );

  return stopListening;
}
