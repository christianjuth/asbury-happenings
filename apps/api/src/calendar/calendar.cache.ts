import type { FastifyBaseLogger } from "fastify";
import Bottleneck from "bottleneck";
import _ from "lodash";
import { getErrorDetails } from "../logging.js";
import { CALENDAR_SOURCES } from "./calendar.config.js";
import dayjs, { type Dayjs } from "./calendar.dates.js";
import { eventsToDebugText, type CalendarDebugPage } from "./calendar.debug.js";
import {
  dedupeEvents,
  eventsToIcs,
  filterCalendarEvents,
  fetchCalendarSourcePage,
  renderSourcePages,
  type CalendarEvent,
  type CalendarSourceConfig,
  type EventFilterInput,
  type FetchStatus,
  type SourcePage,
} from "./calendar.service.js";

const CACHE_REFRESH_MS = 30 * 60_000;
const CACHE_BACKOFF_BASE_MS = 10_000;
const CACHE_BACKOFF_MAX_MS = CACHE_REFRESH_MS;
const CACHE_BACKOFF_JITTER = 0.3;
const SOURCE_HOST_MIN_TIME_MS = 1_000;

interface CachedPage {
  events: CalendarEvent[];
  fetchedAt: Dayjs;
  // Only ever set by a successful fetch, so it keeps pointing at the last known
  // good read while later refreshes fail. `fetchedAt` cannot stand in for this:
  // a repeated failure moves it forward with no new upstream data behind it.
  lastSuccessAt?: Dayjs;
  sourcePage: SourcePage;
  status: FetchStatus;
  error?: string;
}

interface CalendarSnapshot {
  sourceUrls: string[];
  events: CalendarEvent[];
  statuses: FetchStatus[];
  debugPages: CalendarDebugPage[];
  ready: boolean;
  sourceFetchedAt?: Dayjs;
}

interface CachedCalendarEventSnapshot {
  events: CalendarEvent[];
  sourceFetchedAt?: Dayjs;
}

interface CalendarFailure {
  calendarId: string;
  calendarName: string;
  sourceUrl: string;
  status: FetchStatus;
  error?: string;
}

const PAGE_CACHE = new Map<string, CachedPage>();
const REFRESHING_PAGES = new Set<string>();

const CACHE_WORKERS = new Map<string, CalendarCacheWorker>();
const SOURCE_HOST_LIMITERS = new Map<string, Bottleneck>();

export function getCachedCalendarFeed(
  config: CalendarSourceConfig,
  filters?: EventFilterInput,
  now = dayjs(),
): string | null {
  const snapshot = getCalendarSnapshot(config, now);

  if (!snapshot.ready) {
    return null;
  }

  return eventsToIcs(
    config.name,
    filterCalendarEvents(snapshot.events, filters, config.defaultFilters),
  );
}

export function getCachedCalendarDebugText(
  config: CalendarSourceConfig,
  filters?: EventFilterInput,
  now = dayjs(),
): string {
  const snapshot = getCalendarSnapshot(config, now);

  return eventsToDebugText(
    config.name,
    snapshot.sourceUrls,
    filterCalendarEvents(snapshot.events, filters, config.defaultFilters),
    snapshot.statuses,
    snapshot.debugPages,
  );
}

// The cached events plus when upstream was last read successfully. Always
// answerable, unlike the ICS feed: a cold cache is an empty event list rather
// than a 503, and an upstream outage keeps serving the last known good events
// behind a `sourceFetchedAt` that has stopped moving. Callers that publish this
// decide what to do with a stale read; the cache does not editorialize.
export function getCachedCalendarEventSnapshot(
  config: CalendarSourceConfig,
  filters?: EventFilterInput,
  now = dayjs(),
): CachedCalendarEventSnapshot {
  const snapshot = getCalendarSnapshot(config, now);

  return {
    events: filterCalendarEvents(
      snapshot.events,
      filters,
      config.defaultFilters,
    ),
    sourceFetchedAt: snapshot.sourceFetchedAt,
  };
}

export function getCachedCalendarStatusFeed(now = dayjs()): string {
  return eventsToIcs("Calendar Status", buildCalendarStatusEvents(now));
}

export function getCachedCalendarStatusDebugText(now = dayjs()): string {
  const events = buildCalendarStatusEvents(now);

  return eventsToDebugText(
    "Calendar Status",
    "calendar-cache",
    events,
    "fetched",
  );
}

export async function warmCalendarPage(
  config: CalendarSourceConfig,
  pageIndex: number,
  now = dayjs(),
  logger?: FastifyBaseLogger,
): Promise<void> {
  const sourcePages = renderSourcePages(config.url, now);
  const sourcePage = sourcePages[pageIndex % sourcePages.length];

  if (!sourcePage) {
    return;
  }

  await warmCalendarSourcePage(config, sourcePage, logger);
}

export function startCalendarCacheScheduler(
  logger: FastifyBaseLogger,
): () => Promise<void> {
  for (const config of CALENDAR_SOURCES) {
    const worker = new CalendarCacheWorker(config, logger);

    CACHE_WORKERS.set(config.id, worker);
    worker.start();
  }

  return stopCalendarCacheScheduler;
}

async function stopCalendarCacheScheduler(): Promise<void> {
  const workers = [...CACHE_WORKERS.values()];
  const hostLimiters = [...SOURCE_HOST_LIMITERS.values()];

  CACHE_WORKERS.clear();
  SOURCE_HOST_LIMITERS.clear();

  await Promise.all(workers.map((worker) => worker.stop()));
  await Promise.all(
    hostLimiters.map((limiter) =>
      limiter.stop({
        dropWaitingJobs: true,
        dropErrorMessage: "Calendar cache scheduler stopped",
      }),
    ),
  );
}

export function clearCalendarPageCache(): void {
  PAGE_CACHE.clear();
  REFRESHING_PAGES.clear();
}

class CalendarCacheWorker {
  private readonly limiter: Bottleneck;
  private backoffAttempt = 0;
  private pendingPages: SourcePage[] | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly config: CalendarSourceConfig,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.limiter = new Bottleneck({
      id: `calendar-cache:${config.id}`,
      maxConcurrent: 1,
      minTime: 0,
    });
    this.limiter.chain(getSourceHostLimiter(config.url));

    this.limiter.on("error", (error) => {
      this.logger.error(
        { calendarId: this.config.id, ...getErrorDetails(error) },
        "Calendar cache limiter error",
      );
    });
  }

  start(): void {
    this.runCycle();
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    await this.limiter.stop({
      dropWaitingJobs: true,
      dropErrorMessage: "Calendar cache scheduler stopped",
    });
  }

  private runCycle(): void {
    if (this.stopped) {
      return;
    }

    void this.runCycleOnce().catch((error) => {
      if (!this.stopped) {
        this.logger.error(
          { calendarId: this.config.id, ...getErrorDetails(error) },
          "Calendar cache warm cycle failed",
        );
      }
    });
  }

  private async runCycleOnce(): Promise<void> {
    const pendingPages = await this.warmPages(this.pendingPages);

    if (this.stopped) {
      return;
    }

    const delay = this.getNextDelay(pendingPages);

    this.refreshTimer = setTimeout(() => this.runCycle(), delay);
  }

  private async warmPages(pendingPages?: SourcePage[]): Promise<SourcePage[]> {
    const now = dayjs();
    const sourcePages = pendingPages ?? renderSourcePages(this.config.url, now);

    for (const [pageIndex, sourcePage] of sourcePages.entries()) {
      const success = await this.limiter.schedule(
        {
          id: `${this.config.id}:${pageIndex}:${sourcePage.sourceUrl}`,
        },
        async () =>
          warmCalendarSourcePage(this.config, sourcePage, this.logger),
      );

      if (!success) {
        return sourcePages.slice(pageIndex);
      }
    }

    return [];
  }

  private getNextDelay(pendingPages: SourcePage[]): number {
    if (!pendingPages.length) {
      this.backoffAttempt = 0;
      this.pendingPages = undefined;
      return CACHE_REFRESH_MS;
    }

    const delay = getRetryDelayMs(this.backoffAttempt);

    this.backoffAttempt += 1;
    this.pendingPages = pendingPages;
    this.logger.warn(
      {
        calendarId: this.config.id,
        pendingPages: pendingPages.length,
        backoffAttempt: this.backoffAttempt,
        delay,
      },
      "Calendar cache warm cycle retry scheduled",
    );

    return delay;
  }
}

async function warmCalendarSourcePage(
  config: CalendarSourceConfig,
  sourcePage: SourcePage,
  logger?: FastifyBaseLogger,
): Promise<boolean> {
  const key = cacheKey(config, sourcePage);

  REFRESHING_PAGES.add(key);

  try {
    const { events, fetchStatus } = await fetchCalendarSourcePage(
      config,
      sourcePage,
    );

    const fetchedAt = dayjs();

    PAGE_CACHE.set(key, {
      events,
      fetchedAt,
      lastSuccessAt: fetchedAt,
      sourcePage,
      status: fetchStatus,
    });
    return true;
  } catch (error) {
    const existing = PAGE_CACHE.get(key);
    const message = error instanceof Error ? error.message : String(error);

    if (existing && existing.status !== "error") {
      PAGE_CACHE.set(key, {
        ...existing,
        status: "stale",
        error: message,
      });

      return false;
    }

    PAGE_CACHE.set(key, {
      events: existing?.events ?? [],
      fetchedAt: dayjs(),
      lastSuccessAt: existing?.lastSuccessAt,
      sourcePage,
      status: "error",
      error: message,
    });
    if (!existing) {
      logger?.warn(
        {
          calendarId: config.id,
          sourceUrl: sourcePage.sourceUrl,
          ...getErrorDetails(error),
        },
        "Calendar cache warm failed",
      );
    }

    return false;
  } finally {
    REFRESHING_PAGES.delete(key);
  }
}

function getCalendarSnapshot(
  config: CalendarSourceConfig,
  now: Dayjs,
): CalendarSnapshot {
  const sourcePages = renderSourcePages(config.url, now);
  const pageKeys = sourcePages.map((sourcePage) =>
    cacheKey(config, sourcePage),
  );
  const cachedPages = pageKeys.map((key) => PAGE_CACHE.get(key));
  const events = dedupeEvents(
    cachedPages.flatMap((page) => page?.events ?? []),
  );
  const statuses = cachedPages.map((page) => page?.status ?? "warming");
  const debugPages = sourcePages.map((sourcePage, index) =>
    getDebugPage(
      sourcePage.sourceUrl,
      cachedPages[index],
      REFRESHING_PAGES.has(pageKeys[index] ?? ""),
      now,
    ),
  );

  return {
    sourceUrls: sourcePages.map((page) => page.sourceUrl),
    events,
    statuses,
    debugPages,
    ready: cachedPages.some((page) => page && page.status !== "error"),
    // The oldest successful read across the source's pages, not the newest. A
    // multi-page source whose first page refreshes while a later one has been
    // failing for a day is stale, and reporting the fresh page's timestamp would
    // hide exactly the partial outage this field exists to expose.
    sourceFetchedAt: _.minBy(
      _.compact(cachedPages.map((page) => page?.lastSuccessAt)),
      (fetchedAt) => fetchedAt.valueOf(),
    ),
  };
}

function buildCalendarStatusEvents(now: Dayjs): CalendarEvent[] {
  const failures = getCalendarFailures(now);

  if (!failures.length) {
    return [];
  }

  const start = now.startOf("day");

  return [
    {
      title: `Error: ${failures.length} calendar${failures.length === 1 ? "" : "s"} failing`,
      start,
      end: start.add(1, "day"),
      allDay: true,
      description: formatCalendarFailureDescription(failures),
    },
  ];
}

function getCalendarFailures(now: Dayjs): CalendarFailure[] {
  return CALENDAR_SOURCES.flatMap((config) => {
    const snapshot = getCalendarSnapshot(config, now);

    return snapshot.debugPages
      .filter(
        (page) => page.fetchStatus === "error" || page.fetchStatus === "stale",
      )
      .map((page) => ({
        calendarId: config.id,
        calendarName: config.name,
        sourceUrl: page.sourceUrl,
        status: page.fetchStatus,
        error: page.error,
      }));
  });
}

function formatCalendarFailureDescription(failures: CalendarFailure[]): string {
  return failures
    .map((failure) =>
      [
        `${failure.calendarName} (${failure.calendarId})`,
        `Status: ${failure.status}`,
        `Source: ${failure.sourceUrl}`,
        failure.error ? `Error: ${failure.error}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

function getDebugPage(
  sourceUrl: string,
  cachedPage: CachedPage | undefined,
  refreshing: boolean,
  now: Dayjs,
): CalendarDebugPage {
  if (!cachedPage) {
    return {
      sourceUrl,
      fetchStatus: "warming",
      revalidateStatus: refreshing ? "refetching" : "warming",
    };
  }

  const revalidateAt = cachedPage.fetchedAt.add(
    CACHE_REFRESH_MS,
    "millisecond",
  );

  return {
    sourceUrl,
    fetchStatus: cachedPage.status,
    fetchedAt: cachedPage.fetchedAt,
    revalidateStatus: getRevalidateStatus(
      cachedPage,
      refreshing,
      revalidateAt,
      now,
    ),
    revalidateAt,
    error: cachedPage.error,
  };
}

function getRevalidateStatus(
  cachedPage: CachedPage,
  refreshing: boolean,
  revalidateAt: Dayjs,
  now: Dayjs,
): CalendarDebugPage["revalidateStatus"] {
  if (refreshing) {
    return "refetching";
  }

  if (cachedPage.status === "error" || cachedPage.status === "stale") {
    return "error";
  }

  return now.isBefore(revalidateAt) ? "fresh" : "due";
}

function cacheKey(
  { id }: CalendarSourceConfig,
  { sourceUrl }: SourcePage,
): string {
  return `${id}:${sourceUrl}`;
}

function getRetryDelayMs(retryCount: number): number {
  const exponentialDelay = Math.min(
    CACHE_BACKOFF_BASE_MS * 2 ** retryCount,
    CACHE_BACKOFF_MAX_MS,
  );
  const jitter = exponentialDelay * CACHE_BACKOFF_JITTER * Math.random();

  return Math.round(exponentialDelay + jitter);
}

function getSourceHostLimiter(sourceUrlTemplate: string): Bottleneck {
  const hostname = new URL(sourceUrlTemplate).hostname;
  const existing = SOURCE_HOST_LIMITERS.get(hostname);

  if (existing) {
    return existing;
  }

  const limiter = new Bottleneck({
    id: `calendar-cache-host:${hostname}`,
    maxConcurrent: 1,
    minTime: SOURCE_HOST_MIN_TIME_MS,
  });

  SOURCE_HOST_LIMITERS.set(hostname, limiter);
  return limiter;
}
