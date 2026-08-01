import { createHash } from "node:crypto";
import _ from "lodash";

import dayjs, { type Dayjs } from "../calendar/calendar.dates.js";
import type { CalendarEvent } from "../calendar/calendar.types.js";
import { isEventCancelled, normalizeText } from "../calendar/calendar.utils.js";
import {
  SAMANTHA_DRESS_EVENTS_URL,
  SAMANTHA_DRESS_HOST,
  SAMANTHA_DRESS_TIME_ZONE,
  samanthaDressEventUrl,
  samanthaDressRegionalUrl,
} from "../calendar/config/samantha-dress.js";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_MAX_URLS_PER_BATCH = 10_000;
const INDEXNOW_TIMEOUT_MS = 10_000;
const INDEXNOW_RETRY_DELAY_MS = 2_000;
const INDEXNOW_MAX_ATTEMPTS = 2;
const ACCEPTED_STATUS_CODES = new Set([200, 202]);
const RESPONSE_BODY_LOG_LIMIT = 300;
const EVENT_PATH_SEGMENT = "events";
const STATE_SEGMENT_PATTERN = /^[a-z]{2}$/;
const CITY_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_SEGMENT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface IndexNowLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

interface SubmittedEventState {
  fingerprint: string;
  eventUrl: string;
  regionalUrl?: string;
}

export interface IndexNowService {
  readonly enabled: boolean;
  seed(events: readonly CalendarEvent[]): void;
  submitCalendarDiff(events: readonly CalendarEvent[]): Promise<void>;
  submitDailyReconciliation(events: readonly CalendarEvent[]): Promise<void>;
}

// Who invoked the submission. `reason` alone cannot answer this: the CLI runs
// the same reconciliation the daily job does, so without this the two are
// indistinguishable in the logs.
type IndexNowTrigger = "manual" | "scheduled";

interface IndexNowServiceOptions {
  key: string | undefined;
  logger: IndexNowLogger;
  trigger?: IndexNowTrigger;
  fetchImpl?: typeof fetch;
  now?: () => Dayjs;
  timeoutMs?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
}

interface IndexNowEvent {
  uid: string;
  fingerprint: string;
  eventUrl: string;
  regionalUrl?: string;
}

interface SubmissionContext {
  reason: "incremental" | "reconciliation";
  changedEvents?: number;
  unresolvedAddressEvents: number;
}

interface NormalizedEvents {
  events: IndexNowEvent[];
  unresolvedAddressEvents: number;
}

export function createIndexNowService(
  options: IndexNowServiceOptions,
): IndexNowService {
  return new SamanthaDressIndexNowService(options);
}

// Deterministic hash of the event fields that change the rendered event page or
// its structured data. Anything not in here (feed ordering, unrelated iCalendar
// properties) must not trigger an IndexNow submission.
export function buildEventFingerprint(event: CalendarEvent): string {
  const fields: [string, string | null][] = [
    ["uid", normalizeFingerprintText(event.uid)],
    ["summary", normalizeFingerprintText(event.title)],
    ["startDate", normalizeFingerprintDate(event.start)],
    ["endDate", normalizeFingerprintDate(event.end)],
    ["allDay", event.allDay ? "true" : "false"],
    ["location", normalizeFingerprintText(event.address ?? event.location)],
    ["description", normalizeFingerprintText(event.description)],
    ["status", normalizeFingerprintText(event.status) ?? "confirmed"],
    // The raw STATUS property above is not the whole cancellation story: the
    // site also treats a summary that says "canceled" as a cancellation. Hash
    // the same derived flag the page renders from.
    ["cancelled", isEventCancelled(event) ? "true" : "false"],
  ];

  return createHash("sha256")
    .update(JSON.stringify(fields))
    .digest("hex")
    .slice(0, 32);
}

class SamanthaDressIndexNowService implements IndexNowService {
  readonly enabled: boolean;

  private readonly key: string | undefined;
  private readonly logger: IndexNowLogger;
  private readonly trigger: IndexNowTrigger;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Dayjs;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly maxAttempts: number;
  private readonly submittedFingerprints = new Map<
    string,
    SubmittedEventState
  >();
  // Serializes submissions so an incremental diff and the daily reconciliation
  // never race on the fingerprint map. Calendar fetching stays unblocked.
  private queue: Promise<void> = Promise.resolve();

  constructor(options: IndexNowServiceOptions) {
    this.key = normalizeText(options.key) || undefined;
    this.enabled = Boolean(this.key);
    this.logger = options.logger;
    this.trigger = options.trigger ?? "scheduled";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => dayjs());
    this.timeoutMs = options.timeoutMs ?? INDEXNOW_TIMEOUT_MS;
    this.retryDelayMs = options.retryDelayMs ?? INDEXNOW_RETRY_DELAY_MS;
    this.maxAttempts = options.maxAttempts ?? INDEXNOW_MAX_ATTEMPTS;
  }

  seed(events: readonly CalendarEvent[]): void {
    if (!this.enabled) {
      return;
    }

    const { events: indexNowEvents, unresolvedAddressEvents } =
      this.normalizeEvents(events);

    this.replaceSubmittedState(indexNowEvents);
    this.logger.info(
      { events: indexNowEvents.length, unresolvedAddressEvents },
      "IndexNow seeded event fingerprints without submitting",
    );
  }

  async submitCalendarDiff(events: readonly CalendarEvent[]): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.runExclusive(async () => {
      const { events: indexNowEvents, unresolvedAddressEvents } =
        this.normalizeEvents(events);
      const changedEvents = indexNowEvents.filter((event) =>
        this.hasEventChanged(event),
      );

      this.pruneMissingEvents(indexNowEvents);

      if (!changedEvents.length) {
        return;
      }

      const urls = this.buildChangedUrls(changedEvents);
      const accepted = await this.submitUrls(urls, {
        reason: "incremental",
        changedEvents: changedEvents.length,
        unresolvedAddressEvents,
      });

      if (!accepted) {
        // Leave the stored fingerprints untouched so the next calendar refresh
        // resubmits the same events.
        return;
      }

      for (const event of changedEvents) {
        this.storeEventState(event);
      }
    });
  }

  async submitDailyReconciliation(
    events: readonly CalendarEvent[],
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.runExclusive(async () => {
      const { events: indexNowEvents, unresolvedAddressEvents } =
        this.normalizeEvents(events);
      const urls = this.buildReconciliationUrls(indexNowEvents);
      const accepted = await this.submitUrls(urls, {
        reason: "reconciliation",
        unresolvedAddressEvents,
      });

      if (accepted) {
        this.replaceSubmittedState(indexNowEvents);
      }
    });
  }

  private buildChangedUrls(changedEvents: IndexNowEvent[]): string[] {
    const urls = new Set<string>([SAMANTHA_DRESS_EVENTS_URL]);

    for (const event of changedEvents) {
      urls.add(event.eventUrl);

      if (event.regionalUrl) {
        urls.add(event.regionalUrl);
      }

      // A moved event changes two listings: the region it left and the region
      // it joined.
      const previousRegionalUrl = this.submittedFingerprints.get(
        event.uid,
      )?.regionalUrl;

      if (previousRegionalUrl) {
        urls.add(previousRegionalUrl);
      }
    }

    return [...urls];
  }

  private buildReconciliationUrls(indexNowEvents: IndexNowEvent[]): string[] {
    const urls = new Set<string>([SAMANTHA_DRESS_EVENTS_URL]);

    for (const event of indexNowEvents) {
      urls.add(event.eventUrl);

      if (event.regionalUrl) {
        urls.add(event.regionalUrl);
      }
    }

    return [...urls];
  }

  private hasEventChanged(event: IndexNowEvent): boolean {
    const submitted = this.submittedFingerprints.get(event.uid);

    return !submitted || submitted.fingerprint !== event.fingerprint;
  }

  private storeEventState(event: IndexNowEvent): void {
    this.submittedFingerprints.set(event.uid, {
      fingerprint: event.fingerprint,
      eventUrl: event.eventUrl,
      regionalUrl: event.regionalUrl,
    });
  }

  private replaceSubmittedState(indexNowEvents: IndexNowEvent[]): void {
    this.submittedFingerprints.clear();

    for (const event of indexNowEvents) {
      this.storeEventState(event);
    }
  }

  // Events that scrolled out of the published window can never change again,
  // so drop them instead of growing the map forever.
  private pruneMissingEvents(indexNowEvents: IndexNowEvent[]): void {
    const currentUids = new Set(indexNowEvents.map((event) => event.uid));

    for (const uid of this.submittedFingerprints.keys()) {
      if (!currentUids.has(uid)) {
        this.submittedFingerprints.delete(uid);
      }
    }
  }

  private normalizeEvents(events: readonly CalendarEvent[]): NormalizedEvents {
    const now = this.now();
    let unresolvedAddressEvents = 0;

    const normalizedEvents = _.compact(
      events.map((event) => {
        if (!event.uid || !isPubliclyVisible(event, now)) {
          return null;
        }

        const eventUrl = samanthaDressEventUrl(event);

        if (!eventUrl || !isSubmittableUrl(eventUrl)) {
          unresolvedAddressEvents += 1;
          return null;
        }

        const regionalUrl = samanthaDressRegionalUrl(event);

        return {
          uid: event.uid,
          fingerprint: buildEventFingerprint(event),
          eventUrl,
          regionalUrl:
            regionalUrl && isSubmittableUrl(regionalUrl)
              ? regionalUrl
              : undefined,
        };
      }),
    );

    return { events: normalizedEvents, unresolvedAddressEvents };
  }

  private async submitUrls(
    urls: string[],
    context: SubmissionContext,
  ): Promise<boolean> {
    const submittableUrls = urls.filter((url) => isSubmittableUrl(url));

    if (!submittableUrls.length) {
      return false;
    }

    const batches = _.chunk(submittableUrls, INDEXNOW_MAX_URLS_PER_BATCH);
    const results = [];

    for (const batch of batches) {
      results.push(await this.submitBatch(batch, context));
    }

    return results.every(Boolean);
  }

  private async submitBatch(
    urls: string[],
    context: SubmissionContext,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const outcome = await this.postBatch(urls, context, attempt);

      if (outcome === "accepted") {
        return true;
      }

      if (outcome === "rejected" || attempt === this.maxAttempts) {
        return false;
      }

      await delay(this.retryDelayMs);
    }

    return false;
  }

  private async postBatch(
    urls: string[],
    context: SubmissionContext,
    attempt: number,
  ): Promise<"accepted" | "rejected" | "retryable"> {
    const key = this.key;

    if (!key) {
      return "rejected";
    }

    const logContext = {
      trigger: this.trigger,
      ...context,
      urlCount: urls.length,
      attempt,
      key: maskKey(key),
    };

    try {
      const response = await this.fetchImpl(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          host: SAMANTHA_DRESS_HOST,
          key,
          keyLocation: `https://${SAMANTHA_DRESS_HOST}/${key}.txt`,
          urlList: urls,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = redactKey(await readResponseBody(response), key);
      const status = response.status;

      if (ACCEPTED_STATUS_CODES.has(status)) {
        this.logger.info(
          { ...logContext, status, urls },
          "IndexNow submission accepted",
        );

        if (body) {
          this.logger.warn(
            { ...logContext, status, body },
            "IndexNow submission accepted with an unexpected response body",
          );
        }

        return "accepted";
      }

      // 400 bad request, 403 invalid key, 422 URL/key mismatch and 429 throttling
      // all need the response preserved; none of them get retried in-cycle.
      this.logger.error(
        { ...logContext, status, body },
        "IndexNow submission rejected",
      );

      return status >= 500 ? "retryable" : "rejected";
    } catch (error) {
      this.logger.error(
        { ...logContext, ...getErrorDetails(error) },
        "IndexNow submission failed",
      );

      return "retryable";
    }
  }

  private runExclusive(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);

    this.queue = run.catch((error: unknown) => {
      this.logger.error(
        getErrorDetails(error),
        "IndexNow submission threw unexpectedly",
      );
    });

    return this.queue;
  }
}

// Events stay published through the end of their day, cancelled ones included.
// The cutoff is the event day in Samantha Dress's zone, not the server's: on a
// UTC host, midnight UTC is 8pm the previous day in New York, which kept an
// evening event eligible for nearly an extra day.
function isPubliclyVisible(event: CalendarEvent, now: Dayjs): boolean {
  return !event.end.isBefore(now.tz(SAMANTHA_DRESS_TIME_ZONE).startOf("day"));
}

// Only canonical samanthadress.com event pages are submittable. This rejects
// search URLs, query-string variants, calendar-source URLs, trailing-slash
// aliases and any location page shape the site does not serve as an indexable
// page.
export function isSubmittableUrl(value: string): boolean {
  const url = parseUrlOrNull(value);

  if (
    !url ||
    url.protocol !== "https:" ||
    url.host !== SAMANTHA_DRESS_HOST ||
    url.search ||
    url.hash ||
    url.pathname.endsWith("/")
  ) {
    return false;
  }

  const [eventsSegment, ...segments] = url.pathname.split("/").slice(1);

  if (eventsSegment !== EVENT_PATH_SEGMENT) {
    return false;
  }

  // https://samanthadress.com/events
  if (!segments.length) {
    return true;
  }

  const [state, citySlug, date, uid] = segments;

  if (
    !state ||
    !STATE_SEGMENT_PATTERN.test(state) ||
    !citySlug ||
    !CITY_SEGMENT_PATTERN.test(citySlug)
  ) {
    return false;
  }

  // https://samanthadress.com/events/nj/monmouth-county
  if (segments.length === 2) {
    return true;
  }

  // https://samanthadress.com/events/nj/monmouth-county/2026-09-17/<uid>
  return (
    segments.length === 4 &&
    Boolean(date) &&
    DATE_SEGMENT_PATTERN.test(date ?? "") &&
    Boolean(uid) &&
    !/[\s/]/.test(uid ?? " ")
  );
}

function parseUrlOrNull(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return normalizeText(await response.text()).slice(
      0,
      RESPONSE_BODY_LOG_LIMIT,
    );
  } catch {
    return "";
  }
}

function normalizeFingerprintText(value: string | undefined): string | null {
  return normalizeText(value) || null;
}

function normalizeFingerprintDate(value: Dayjs): string | null {
  return value.isValid() ? value.utc().toISOString() : null;
}

function maskKey(key: string): string {
  return `${key.slice(0, 4)}…`;
}

function redactKey(value: string, key: string): string {
  return value.replaceAll(key, "[redacted]");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Keep structured log context small and JSON-safe instead of passing raw errors.
function getErrorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { errorMessage: String(error) };
  }

  return {
    errorName: error.name,
    errorMessage: error.message,
  };
}
