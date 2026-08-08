import type { FastifyBaseLogger } from "fastify";

import { ENV } from "../env.js";
import { onSamanthaDressRefresh } from "../samantha-dress/samantha-dress.cache.js";
import { SAMANTHA_DRESS_SOURCE } from "../samantha-dress/samantha-dress.config.js";
import { createIndexNowService } from "./index-now.service.js";

// Wires the IndexNow service to the dedicated Samantha Dress source. The first
// successful refresh only seeds fingerprints; every later refresh submits only
// its changed events.
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
  const stopListening = onSamanthaDressRefresh((events) => {
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
