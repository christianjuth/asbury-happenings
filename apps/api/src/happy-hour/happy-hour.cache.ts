import type { FastifyBaseLogger } from "fastify";

import dayjs, { type Dayjs } from "../calendar/calendar.dates.js";
import { filterCalendarEvents, type FetchStatus } from "../calendar/calendar.service.js";
import { HAPPY_HOUR_SOURCE, type HappyHourSourceConfig } from "./happy-hour.config.js";
import {
  fetchHappyHourEvents,
  happyHourEventsToDebugText,
  happyHourEventsToIcs,
  type HappyHourEvent
} from "./happy-hour.service.js";

const CACHE_BACKOFF_BASE_MS = 5_000;
const CACHE_BACKOFF_MAX_MS = 15 * 60_000;
const CACHE_BACKOFF_JITTER = 0.3;
const HAPPY_HOUR_REFRESH_MS = 15 * 60_000;

interface HappyHourSnapshot {
  sourceUrl: string;
  events: HappyHourEvent[];
  fetchedAt: Dayjs;
  status: FetchStatus;
  error?: string;
}

let SNAPSHOT: HappyHourSnapshot | undefined;
let REFRESH_TIMER: NodeJS.Timeout | undefined;
let STOPPED = false;
let BACKOFF_ATTEMPT = 0;

export function getCachedHappyHourFeed(
  config: HappyHourSourceConfig = HAPPY_HOUR_SOURCE,
  filters?: string | string[]
): string | null {
  if (!SNAPSHOT || SNAPSHOT.status === "error") {
    return null;
  }

  return happyHourEventsToIcs(config.name, filterCalendarEvents(SNAPSHOT.events, filters));
}

export function getCachedHappyHourDebugText(
  config: HappyHourSourceConfig = HAPPY_HOUR_SOURCE,
  filters?: string | string[]
): string {
  if (!SNAPSHOT) {
    return happyHourEventsToDebugText(config.name, config.url, [], "warming");
  }

  return happyHourEventsToDebugText(
    config.name,
    SNAPSHOT.sourceUrl,
    filterCalendarEvents(SNAPSHOT.events, filters),
    SNAPSHOT.status
  );
}

export async function warmHappyHourCache(
  config: HappyHourSourceConfig = HAPPY_HOUR_SOURCE,
  now = dayjs(),
  logger?: FastifyBaseLogger
): Promise<boolean> {
  try {
    const { sourceUrl, events, fetchStatus } = await fetchHappyHourEvents(config, now);

    SNAPSHOT = {
      sourceUrl,
      events,
      fetchedAt: dayjs(),
      status: fetchStatus
    };
    BACKOFF_ATTEMPT = 0;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    SNAPSHOT = {
      sourceUrl: config.url,
      events: SNAPSHOT?.events ?? [],
      fetchedAt: dayjs(),
      status: SNAPSHOT ? "stale" : "error",
      error: message
    };
    logger?.warn({ errorName: error instanceof Error ? error.name : undefined, errorMessage: message }, "Happy hour cache warm failed");
    return false;
  }
}

export function startHappyHourCacheScheduler(logger: FastifyBaseLogger): () => Promise<void> {
  STOPPED = false;
  void runHappyHourCacheCycle(HAPPY_HOUR_SOURCE, logger);

  return stopHappyHourCacheScheduler;
}

export async function stopHappyHourCacheScheduler(): Promise<void> {
  STOPPED = true;

  if (REFRESH_TIMER) {
    clearTimeout(REFRESH_TIMER);
    REFRESH_TIMER = undefined;
  }
}

export function clearHappyHourCache(): void {
  SNAPSHOT = undefined;
  BACKOFF_ATTEMPT = 0;
}

async function runHappyHourCacheCycle(config: HappyHourSourceConfig, logger: FastifyBaseLogger): Promise<void> {
  const success = await warmHappyHourCache(config, dayjs(), logger);

  if (STOPPED) {
    return;
  }

  REFRESH_TIMER = setTimeout(
    () => {
      void runHappyHourCacheCycle(config, logger);
    },
    success ? HAPPY_HOUR_REFRESH_MS : getRetryDelayMs()
  );
}

function getRetryDelayMs(): number {
  const exponentialDelay = Math.min(CACHE_BACKOFF_BASE_MS * 2 ** BACKOFF_ATTEMPT, CACHE_BACKOFF_MAX_MS);
  const jitter = exponentialDelay * CACHE_BACKOFF_JITTER * Math.random();

  BACKOFF_ATTEMPT += 1;
  return Math.round(exponentialDelay + jitter);
}
