import type { FastifyBaseLogger } from "fastify";

import dayjs, { type Dayjs } from "../calendar/calendar.dates.js";
import type { CalendarEvent } from "../calendar/calendar.types.js";
import { getErrorDetails } from "../logging.js";
import { SAMANTHA_DRESS_SOURCE } from "./samantha-dress.config.js";
import {
  abortSamanthaDressFetch,
  fetchSamanthaDressEvents,
} from "./samantha-dress.fetch.js";

const EVENTS_REFRESH_MS = 5 * 60_000;

interface SamanthaDressEventSnapshot {
  events: CalendarEvent[];
  sourceFetchedAt?: Dayjs;
}

type SamanthaDressRefreshListener = (events: CalendarEvent[]) => void;

let snapshot: SamanthaDressEventSnapshot = { events: [] };
let pendingRefresh: Promise<boolean> | undefined;
const REFRESH_LISTENERS = new Set<SamanthaDressRefreshListener>();

// This cache is deliberately separate from the shared calendar cache. The JSON
// service can poll more often without changing the cadence or contents served by
// the legacy `/calendar/samantha-dress.ics` route.
export function getSamanthaDressEventSnapshot(): SamanthaDressEventSnapshot {
  return snapshot;
}

export function getSamanthaDressEventStatus(): {
  warm: boolean;
  eventCount: number;
} {
  return {
    warm: Boolean(snapshot.sourceFetchedAt),
    eventCount: snapshot.events.length,
  };
}

export function onSamanthaDressRefresh(
  listener: SamanthaDressRefreshListener,
): () => void {
  REFRESH_LISTENERS.add(listener);

  return () => {
    REFRESH_LISTENERS.delete(listener);
  };
}

export async function warmSamanthaDressEventsPage(
  logger?: FastifyBaseLogger,
): Promise<boolean> {
  if (pendingRefresh) {
    return pendingRefresh;
  }

  pendingRefresh = refreshSamanthaDressEventsPage(logger);

  try {
    return await pendingRefresh;
  } finally {
    pendingRefresh = undefined;
  }
}

export function clearSamanthaDressEventSnapshot(): void {
  snapshot = { events: [] };
}

export function startSamanthaDressEventsScheduler(
  logger: FastifyBaseLogger,
): () => Promise<void> {
  let stopped = false;
  let refreshTimer: NodeJS.Timeout | undefined;
  let activeCycle: Promise<void> | undefined;

  const runCycle = async (): Promise<void> => {
    try {
      await warmSamanthaDressEventsPage(logger);
    } catch (error) {
      logger.error(
        { calendarId: SAMANTHA_DRESS_SOURCE.id, ...getErrorDetails(error) },
        "Samantha Dress events warm cycle failed",
      );
    }

    if (!stopped) {
      refreshTimer = setTimeout(() => {
        activeCycle = runCycle();
      }, EVENTS_REFRESH_MS);
    }
  };

  activeCycle = runCycle();

  return async () => {
    stopped = true;

    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }

    abortSamanthaDressFetch();
    await activeCycle;
  };
}

async function refreshSamanthaDressEventsPage(
  logger?: FastifyBaseLogger,
): Promise<boolean> {
  try {
    const events = await fetchSamanthaDressEvents();
    const fetchedAt = dayjs();

    snapshot = {
      events,
      sourceFetchedAt: fetchedAt,
    };
    notifySamanthaDressRefreshed(events, logger);

    return true;
  } catch (error) {
    logger?.warn(
      {
        calendarId: SAMANTHA_DRESS_SOURCE.id,
        sourceUrl: SAMANTHA_DRESS_SOURCE.url,
        ...getErrorDetails(error),
      },
      "Samantha Dress events cache refresh failed",
    );

    return false;
  }
}

function notifySamanthaDressRefreshed(
  events: CalendarEvent[],
  logger?: FastifyBaseLogger,
): void {
  for (const listener of REFRESH_LISTENERS) {
    try {
      listener(events);
    } catch (error) {
      logger?.error(
        { calendarId: SAMANTHA_DRESS_SOURCE.id, ...getErrorDetails(error) },
        "Samantha Dress refresh listener failed",
      );
    }
  }
}
