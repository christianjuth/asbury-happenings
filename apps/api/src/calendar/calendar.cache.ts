import type { FastifyBaseLogger } from "fastify";
import { CALENDAR_SOURCES } from "./calendar.config.js";
import {
  dedupeEvents,
  eventsToDebugText,
  eventsToIcs,
  filterCalendarEvents,
  fetchCalendarSourcePage,
  renderSourcePages,
  type CalendarEvent,
  type CalendarSourceConfig,
  type EventFilterInput,
  type FetchStatus,
  type SourcePage
} from "./calendar.service.js";

const CACHE_TICK_MS = 15 * 60_000;

interface CachedPage {
  events: CalendarEvent[];
  fetchedAt: Date;
  sourcePage: SourcePage;
  status: FetchStatus;
  error?: string;
}

interface CalendarSnapshot {
  sourceUrls: string[];
  events: CalendarEvent[];
  statuses: FetchStatus[];
  ready: boolean;
}

const PAGE_CACHE = new Map<string, CachedPage>();

let scheduler: NodeJS.Timeout | undefined;
let nextPageIndex = 1;
let warming = false;

export function getCachedCalendarFeed(
  config: CalendarSourceConfig,
  filters?: EventFilterInput,
  now = new Date()
): string | null {
  const snapshot = getCalendarSnapshot(config, now);

  if (!snapshot.ready) {
    return null;
  }

  return eventsToIcs(config.name, filterCalendarEvents(snapshot.events, filters, config.defaultFilters));
}

export function getCachedCalendarDebugText(
  config: CalendarSourceConfig,
  filters?: EventFilterInput,
  now = new Date()
): string {
  const snapshot = getCalendarSnapshot(config, now);

  return eventsToDebugText(
    config.name,
    snapshot.sourceUrls,
    filterCalendarEvents(snapshot.events, filters, config.defaultFilters),
    snapshot.statuses
  );
}

export async function warmCalendarPage(
  config: CalendarSourceConfig,
  pageIndex: number,
  now = new Date(),
  logger?: FastifyBaseLogger
): Promise<void> {
  const sourcePages = renderSourcePages(config.url, now);
  const sourcePage = sourcePages[pageIndex % sourcePages.length];

  if (!sourcePage) {
    return;
  }

  try {
    const { events, cacheStatus } = await fetchCalendarSourcePage(config, sourcePage);

    PAGE_CACHE.set(cacheKey(config.id, sourcePage.sourceUrl), {
      events,
      fetchedAt: new Date(),
      sourcePage,
      status: cacheStatus
    });
  } catch (error) {
    const existing = PAGE_CACHE.get(cacheKey(config.id, sourcePage.sourceUrl));
    const message = error instanceof Error ? error.message : String(error);

    if (existing) {
      PAGE_CACHE.set(cacheKey(config.id, sourcePage.sourceUrl), {
        ...existing,
        status: "stale",
        error: message
      });
      return;
    }

    PAGE_CACHE.set(cacheKey(config.id, sourcePage.sourceUrl), {
      events: [],
      fetchedAt: new Date(),
      sourcePage,
      status: "error",
      error: message
    });
    logger?.warn({ calendarId: config.id, sourceUrl: sourcePage.sourceUrl, error }, "Calendar cache warm failed");
  }
}

export function startCalendarCacheScheduler(logger: FastifyBaseLogger): () => void {
  void warmAllCalendarsPage(0, logger);

  scheduler = setInterval(() => {
    void warmAllCalendarsPage(nextPageIndex, logger);
    nextPageIndex = (nextPageIndex + 1) % 3;
  }, CACHE_TICK_MS);

  return stopCalendarCacheScheduler;
}

export function stopCalendarCacheScheduler(): void {
  if (scheduler) {
    clearInterval(scheduler);
    scheduler = undefined;
  }
}

export function clearCalendarPageCache(): void {
  PAGE_CACHE.clear();
  nextPageIndex = 1;
  warming = false;
}

async function warmAllCalendarsPage(pageIndex: number, logger: FastifyBaseLogger): Promise<void> {
  if (warming) {
    return;
  }

  warming = true;

  try {
    for (const config of CALENDAR_SOURCES) {
      await warmCalendarPage(config, pageIndex, new Date(), logger);
    }
  } finally {
    warming = false;
  }
}

function getCalendarSnapshot(config: CalendarSourceConfig, now: Date): CalendarSnapshot {
  const sourcePages = renderSourcePages(config.url, now);
  const cachedPages = sourcePages.map((sourcePage) => PAGE_CACHE.get(cacheKey(config.id, sourcePage.sourceUrl)));
  const events = dedupeEvents(cachedPages.flatMap((page) => page?.events ?? []));
  const statuses = cachedPages.map((page) => page?.status ?? "warming");

  return {
    sourceUrls: sourcePages.map((page) => page.sourceUrl),
    events,
    statuses,
    ready: cachedPages.some((page) => page && page.status !== "error")
  };
}

function cacheKey(calendarId: string, sourceUrl: string): string {
  return `${calendarId}:${sourceUrl}`;
}
