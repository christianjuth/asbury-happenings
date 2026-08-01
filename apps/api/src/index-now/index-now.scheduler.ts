import type { FastifyBaseLogger } from "fastify";

import {
  getCachedCalendarEvents,
  onCalendarRefresh,
} from "../calendar/calendar.cache.js";
import dayjs, { type Dayjs } from "../calendar/calendar.dates.js";
import { SAMANTHA_DRESS_SOURCE } from "../calendar/config/samantha-dress.js";
import { ENV } from "../env.js";
import { createIndexNowService } from "./index-now.service.js";

// Roughly 3am America/New_York, so a reconciliation batch lands during the
// quietest part of the day.
const RECONCILIATION_HOUR_UTC = 7;
const WARMUP_RETRY_MS = 15 * 60_000;

// Wires the IndexNow service to the calendar cache: the first successful warm
// after startup only seeds fingerprints, every later warm submits the diff, and
// a daily job resubmits the full canonical URL set.
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

  let stopped = false;
  let reconciliationTimer: NodeJS.Timeout | undefined;
  // Anchored to a wall-clock hour instead of counting 24 hours from boot, so a
  // deploy or restart does not push the recovery job a full day out. It never
  // runs at startup, which keeps restart loops from submitting in bursts.
  const scheduleReconciliation = (
    delayMs = msUntilNextReconciliation(dayjs()),
  ): void => {
    if (stopped) {
      return;
    }

    reconciliationTimer = setTimeout(() => {
      // A restart shortly before the anchor hour can reach it before the
      // calendar has warmed. Reconciling then would submit a lone /events and
      // overwrite the fingerprint map with an empty snapshot, leaving the real
      // event URLs unsubmitted until the next day. Wait for a warm cache.
      if (!seeded) {
        logger.warn(
          { calendarId: SAMANTHA_DRESS_SOURCE.id, retryInMs: WARMUP_RETRY_MS },
          "IndexNow daily reconciliation deferred until the calendar cache is warm",
        );
        scheduleReconciliation(WARMUP_RETRY_MS);
        return;
      }

      void service
        .submitDailyReconciliation(
          getCachedCalendarEvents(SAMANTHA_DRESS_SOURCE),
        )
        .finally(() => scheduleReconciliation());
    }, delayMs);
  };

  scheduleReconciliation();
  logger.info(
    {
      calendarId: SAMANTHA_DRESS_SOURCE.id,
      reconciliationHourUtc: RECONCILIATION_HOUR_UTC,
    },
    "IndexNow enabled for Samantha Dress calendar refreshes",
  );

  return () => {
    stopped = true;
    stopListening();

    if (reconciliationTimer) {
      clearTimeout(reconciliationTimer);
      reconciliationTimer = undefined;
    }
  };
}

export function msUntilNextReconciliation(now: Dayjs): number {
  const anchor = now.utc().startOf("hour").hour(RECONCILIATION_HOUR_UTC);
  const next = anchor.isAfter(now) ? anchor : anchor.add(1, "day");

  return next.diff(now);
}
