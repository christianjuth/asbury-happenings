import type { FastifyBaseLogger } from "fastify";
import Bottleneck from "bottleneck";
import { CALENDAR_SOURCES } from "./calendar.config.js";
import dayjs, { type Dayjs } from "./calendar.dates.js";
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

const CACHE_REFRESH_MS = 15 * 60_000;
const CACHE_BACKOFF_BASE_MS = 5_000;
const CACHE_BACKOFF_MAX_MS = 15 * 60_000;
const CACHE_BACKOFF_JITTER = 0.3;

interface CachedPage {
  events: CalendarEvent[];
  fetchedAt: Dayjs;
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

interface HardStoppableBottleneck extends Bottleneck {
  _scheduled?: Record<
    string,
    {
      timeout?: NodeJS.Timeout;
      expiration?: NodeJS.Timeout;
      job?: {
        doDrop: (options?: { message?: string }) => boolean;
      };
    }
  >;
}

const PAGE_CACHE = new Map<string, CachedPage>();

const CACHE_WORKERS = new Map<string, CalendarCacheWorker>();

export function getCachedCalendarFeed(
  config: CalendarSourceConfig,
  filters?: EventFilterInput,
  now = dayjs()
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
  now = dayjs()
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
  now = dayjs(),
  logger?: FastifyBaseLogger
): Promise<void> {
  const sourcePages = renderSourcePages(config.url, now);
  const sourcePage = sourcePages[pageIndex % sourcePages.length];

  if (!sourcePage) {
    return;
  }

  await warmCalendarSourcePage(config, sourcePage, logger, false);
}

export function startCalendarCacheScheduler(logger: FastifyBaseLogger): () => Promise<void> {
  for (const config of CALENDAR_SOURCES) {
    const worker = new CalendarCacheWorker(config, logger);

    CACHE_WORKERS.set(config.id, worker);
    worker.start();
  }

  return stopCalendarCacheScheduler;
}

export async function stopCalendarCacheScheduler(): Promise<void> {
  const workers = [...CACHE_WORKERS.values()];

  CACHE_WORKERS.clear();

  await Promise.all(workers.map((worker) => worker.stop()));
}

export function clearCalendarPageCache(): void {
  PAGE_CACHE.clear();
}

class CalendarCacheWorker {
  private readonly limiter: HardStoppableBottleneck;
  private refreshTimer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly config: CalendarSourceConfig,
    private readonly logger: FastifyBaseLogger
  ) {
    this.limiter = new Bottleneck({
      id: `calendar-cache:${config.id}`,
      maxConcurrent: 1,
      minTime: 0
    });

    this.limiter.on("error", (error) => {
      this.logger.error({ calendarId: this.config.id, error }, "Calendar cache limiter error");
    });

    this.limiter.on("failed", (error, jobInfo) => {
      if (this.stopped) {
        return null;
      }

      const delay = getRetryDelayMs(jobInfo.retryCount);

      this.logger.warn(
        { calendarId: this.config.id, jobId: jobInfo.options.id, retryCount: jobInfo.retryCount, delay, error },
        "Calendar cache warm retry scheduled"
      );

      return delay;
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

    forceDropScheduledJobs(this.limiter, "Calendar cache scheduler stopped");

    await this.limiter.stop({
      dropWaitingJobs: true,
      dropErrorMessage: "Calendar cache scheduler stopped"
    });
  }

  private runCycle(): void {
    if (this.stopped) {
      return;
    }

    void this.warmAllPages()
      .catch((error) => {
        if (!this.stopped) {
          this.logger.error({ calendarId: this.config.id, error }, "Calendar cache warm cycle failed");
        }
      })
      .finally(() => {
        if (!this.stopped) {
          this.refreshTimer = setTimeout(() => this.runCycle(), CACHE_REFRESH_MS);
        }
      });
  }

  private async warmAllPages(): Promise<void> {
    const now = dayjs();
    const sourcePages = renderSourcePages(this.config.url, now);

    await Promise.all(
      sourcePages.map((sourcePage, pageIndex) =>
        this.limiter.schedule(
          {
            id: `${this.config.id}:${pageIndex}:${sourcePage.sourceUrl}`
          },
          async () => warmCalendarSourcePage(this.config, sourcePage, this.logger, true)
        )
      )
    );
  }
}

async function warmCalendarSourcePage(
  config: CalendarSourceConfig,
  sourcePage: SourcePage,
  logger: FastifyBaseLogger | undefined,
  throwOnError: boolean
): Promise<void> {
  try {
    const { events, cacheStatus } = await fetchCalendarSourcePage(config, sourcePage);

    PAGE_CACHE.set(cacheKey(config.id, sourcePage.sourceUrl), {
      events,
      fetchedAt: dayjs(),
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

      if (throwOnError) {
        throw error;
      }

      return;
    }

    PAGE_CACHE.set(cacheKey(config.id, sourcePage.sourceUrl), {
      events: [],
      fetchedAt: dayjs(),
      sourcePage,
      status: "error",
      error: message
    });
    logger?.warn({ calendarId: config.id, sourceUrl: sourcePage.sourceUrl, error }, "Calendar cache warm failed");

    if (throwOnError) {
      throw error;
    }
  }
}

function getCalendarSnapshot(config: CalendarSourceConfig, now: Dayjs): CalendarSnapshot {
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

function getRetryDelayMs(retryCount: number): number {
  const exponentialDelay = Math.min(CACHE_BACKOFF_BASE_MS * 2 ** retryCount, CACHE_BACKOFF_MAX_MS);
  const jitter = exponentialDelay * CACHE_BACKOFF_JITTER * Math.random();

  return Math.round(exponentialDelay + jitter);
}

function forceDropScheduledJobs(limiter: HardStoppableBottleneck, message: string): void {
  const scheduled = limiter._scheduled;

  if (!scheduled) {
    return;
  }

  // Bottleneck leaves retry-delayed jobs in EXECUTING; stop() waits for them unless we clear them first.
  for (const [id, scheduledJob] of Object.entries(scheduled)) {
    if (scheduledJob.timeout) {
      clearTimeout(scheduledJob.timeout);
    }

    if (scheduledJob.expiration) {
      clearTimeout(scheduledJob.expiration);
    }

    scheduledJob.job?.doDrop({ message });
    delete scheduled[id];
  }
}
