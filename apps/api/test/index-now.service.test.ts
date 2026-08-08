import { describe, expect, it, vi } from "vitest";

import dayjs from "../src/calendar/calendar.dates.js";
import type { CalendarEvent } from "../src/calendar/calendar.types.js";
import { isEventCancelled } from "../src/calendar/calendar.utils.js";
import {
  buildEventFingerprint,
  createIndexNowService,
  isSubmittableUrl,
  type IndexNowLogger,
  type IndexNowService,
} from "../src/index-now/index-now.service.js";

const NOW = dayjs("2026-09-01T12:00:00Z");
const KEY = "0123456789abcdef0123456789abcdef";
const EVENTS_URL = "https://samanthadress.com/events";
const FREEHOLD_URL = "https://samanthadress.com/events/nj/freehold";
const LONG_BRANCH_URL = "https://samanthadress.com/events/nj/long-branch";
const FREEHOLD_ADDRESS = "123 Main St, Freehold, NJ 07728";
const LONG_BRANCH_ADDRESS = "640 Ocean Ave, Long Branch, NJ 07740";
const FIRST_EVENT_URL = `${FREEHOLD_URL}/2026-09-17/first%40samanthadress.com`;
const SECOND_EVENT_URL = `${FREEHOLD_URL}/2026-09-18/second%40samanthadress.com`;

interface Harness {
  service: IndexNowService;
  fetchImpl: ReturnType<typeof vi.fn>;
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

function createHarness(
  responses: (() => Promise<Response>)[] = [],
  keyOverride?: { key: string | undefined },
  nowIso?: string,
): Harness {
  const key = keyOverride ? keyOverride.key : KEY;
  const now = nowIso ? dayjs(nowIso) : NOW;
  const queuedResponses = [...responses];
  const fetchImpl = vi.fn(async () => {
    const next = queuedResponses.shift();

    return next ? next() : new Response("", { status: 200 });
  });
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies IndexNowLogger;
  const service = createIndexNowService({
    key,
    logger,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => now,
    retryDelayMs: 0,
  });

  return { service, fetchImpl, logger };
}

function respondWith(status: number, body = ""): () => Promise<Response> {
  return async () => new Response(body, { status });
}

function buildEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: "first@samanthadress.com",
    title: "Fall Trunk Show",
    // 6:00 PM America/New_York on 2026-09-17.
    start: dayjs("2026-09-17T22:00:00Z"),
    end: dayjs("2026-09-18T00:00:00Z"),
    description: "Preview the fall collection.",
    location: FREEHOLD_ADDRESS,
    address: FREEHOLD_ADDRESS,
    ...overrides,
  };
}

function buildSecondEvent(
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return buildEvent({
    uid: "second@samanthadress.com",
    title: "Sample Sale",
    start: dayjs("2026-09-18T22:00:00Z"),
    end: dayjs("2026-09-19T00:00:00Z"),
    ...overrides,
  });
}

function submittedUrls(
  fetchImpl: ReturnType<typeof vi.fn>,
  callIndex = 0,
): string[] {
  const call = fetchImpl.mock.calls[callIndex];

  expect(call).toBeDefined();

  const body = JSON.parse(String((call?.[1] as RequestInit).body)) as {
    urlList: string[];
  };

  return body.urlList;
}

function submittedBody(fetchImpl: ReturnType<typeof vi.fn>): unknown {
  const call = fetchImpl.mock.calls[0];

  return JSON.parse(String((call?.[1] as RequestInit).body));
}

describe("buildEventFingerprint", () => {
  it("is stable for identically normalized events", () => {
    const first = buildEvent();
    const second = buildEvent({
      title: "  Fall Trunk   Show ",
      description: "Preview the fall collection. ",
      start: dayjs("2026-09-17T22:00:00.000Z"),
    });

    expect(buildEventFingerprint(first)).toBe(buildEventFingerprint(second));
  });

  it("changes when the summary changes", () => {
    expect(buildEventFingerprint(buildEvent())).not.toBe(
      buildEventFingerprint(buildEvent({ title: "Winter Trunk Show" })),
    );
  });

  it("changes when the event time changes", () => {
    expect(buildEventFingerprint(buildEvent())).not.toBe(
      buildEventFingerprint(
        buildEvent({ start: dayjs("2026-09-17T23:00:00Z") }),
      ),
    );
  });

  it("changes when the end time changes", () => {
    expect(buildEventFingerprint(buildEvent())).not.toBe(
      buildEventFingerprint(buildEvent({ end: dayjs("2026-09-18T02:00:00Z") })),
    );
  });

  it("changes when the location changes", () => {
    expect(buildEventFingerprint(buildEvent())).not.toBe(
      buildEventFingerprint(
        buildEvent({
          location: LONG_BRANCH_ADDRESS,
          address: LONG_BRANCH_ADDRESS,
        }),
      ),
    );
  });

  it("changes when the status becomes cancelled", () => {
    expect(buildEventFingerprint(buildEvent())).not.toBe(
      buildEventFingerprint(buildEvent({ status: "cancelled" })),
    );
  });

  it("changes when only the summary marks the event canceled", () => {
    expect(buildEventFingerprint(buildEvent())).not.toBe(
      buildEventFingerprint(
        buildEvent({ title: "Fall Trunk Show (Canceled)" }),
      ),
    );
  });

  it("hashes the cancellation the site renders, not just the STATUS property", () => {
    const summaryOnly = buildEvent({ title: "Fall Trunk Show (Canceled)" });

    expect(isEventCancelled(summaryOnly)).toBe(true);
    expect(buildEventFingerprint(summaryOnly)).not.toBe(
      buildEventFingerprint(buildEvent({ status: "cancelled" })),
    );
  });

  it("treats a missing status as confirmed", () => {
    expect(buildEventFingerprint(buildEvent())).toBe(
      buildEventFingerprint(buildEvent({ status: "confirmed" })),
    );
  });
});

describe("isSubmittableUrl", () => {
  it("accepts canonical event, regional and index URLs", () => {
    expect(isSubmittableUrl(EVENTS_URL)).toBe(true);
    expect(isSubmittableUrl(FREEHOLD_URL)).toBe(true);
    expect(isSubmittableUrl(FIRST_EVENT_URL)).toBe(true);
  });

  it("rejects search, query-string, noncanonical and off-site URLs", () => {
    expect(isSubmittableUrl(`${EVENTS_URL}/search?q=dress`)).toBe(false);
    expect(isSubmittableUrl(`${EVENTS_URL}?page=2`)).toBe(false);
    expect(isSubmittableUrl(`${EVENTS_URL}#upcoming`)).toBe(false);
    expect(isSubmittableUrl(`${EVENTS_URL}/`)).toBe(false);
    expect(isSubmittableUrl("http://samanthadress.com/events")).toBe(false);
    expect(isSubmittableUrl("https://www.samanthadress.com/events")).toBe(
      false,
    );
    expect(isSubmittableUrl("https://samanthadress.com/about")).toBe(false);
    expect(
      isSubmittableUrl(
        "https://calendar.google.com/calendar/ical/abc/public/basic.ics",
      ),
    ).toBe(false);
  });

  it("rejects location pages the site does not serve as indexable pages", () => {
    expect(isSubmittableUrl(`${EVENTS_URL}/nj`)).toBe(false);
    expect(isSubmittableUrl(`${EVENTS_URL}/new-jersey/freehold`)).toBe(false);
    expect(isSubmittableUrl(`${EVENTS_URL}/nj/Freehold`)).toBe(false);
    expect(isSubmittableUrl(`${EVENTS_URL}/nj/freehold/2026-09-17`)).toBe(
      false,
    );
    expect(isSubmittableUrl(`${EVENTS_URL}/nj/freehold/09-17-2026/first`)).toBe(
      false,
    );
  });
});

describe("submitCalendarDiff", () => {
  it("does not submit anything when no event changed", async () => {
    const { service, fetchImpl } = createHarness();
    const events = [buildEvent(), buildSecondEvent()];

    service.seed(events);
    await service.submitCalendarDiff(events);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("submits a new event with its detail, index and regional URLs", async () => {
    const { service, fetchImpl } = createHarness();

    service.seed([buildEvent()]);
    await service.submitCalendarDiff([buildEvent(), buildSecondEvent()]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(submittedUrls(fetchImpl).sort()).toEqual(
      [EVENTS_URL, FREEHOLD_URL, SECOND_EVENT_URL].sort(),
    );
  });

  it("submits a changed event", async () => {
    const { service, fetchImpl } = createHarness();

    service.seed([buildEvent(), buildSecondEvent()]);
    await service.submitCalendarDiff([
      buildEvent({ title: "Fall Trunk Show (New Time)" }),
      buildSecondEvent(),
    ]);

    expect(submittedUrls(fetchImpl).sort()).toEqual(
      [EVENTS_URL, FREEHOLD_URL, FIRST_EVENT_URL].sort(),
    );
  });

  // Both halves of the site's cancellation rule have to reach IndexNow:
  // organizers sometimes flip STATUS and sometimes only retitle the event.
  it.each([
    ["a cancelled STATUS", { status: "cancelled" } as Partial<CalendarEvent>],
    [
      "a summary that says canceled",
      { title: "Fall Trunk Show - CANCELED" } as Partial<CalendarEvent>,
    ],
  ])("submits %s as a material change", async (_label, change) => {
    const { service, fetchImpl } = createHarness();

    service.seed([buildEvent()]);
    await service.submitCalendarDiff([buildEvent(change)]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(submittedUrls(fetchImpl)).toContain(FIRST_EVENT_URL);
  });

  it("submits each URL once when several events share a region", async () => {
    const { service, fetchImpl } = createHarness();

    await service.submitCalendarDiff([buildEvent(), buildSecondEvent()]);

    const urls = submittedUrls(fetchImpl);

    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.sort()).toEqual(
      [EVENTS_URL, FREEHOLD_URL, FIRST_EVENT_URL, SECOND_EVENT_URL].sort(),
    );
  });

  it("submits the previous and the new regional page after a region move", async () => {
    const { service, fetchImpl } = createHarness();

    service.seed([buildEvent()]);
    await service.submitCalendarDiff([
      buildEvent({
        location: LONG_BRANCH_ADDRESS,
        address: LONG_BRANCH_ADDRESS,
      }),
    ]);

    expect(submittedUrls(fetchImpl).sort()).toEqual(
      [
        EVENTS_URL,
        FREEHOLD_URL,
        LONG_BRANCH_URL,
        `${LONG_BRANCH_URL}/2026-09-17/first%40samanthadress.com`,
      ].sort(),
    );
  });

  it("skips events whose addresses do not resolve to a city", async () => {
    const { service, fetchImpl } = createHarness();
    const event = buildEvent({ location: "TBD", address: "TBD" });

    await service.submitCalendarDiff([event]);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("logs unresolved address counts alongside a submission", async () => {
    const { service, logger } = createHarness();

    await service.submitCalendarDiff([
      buildEvent(),
      buildSecondEvent({ location: "TBD", address: "TBD" }),
    ]);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ unresolvedAddressEvents: 1 }),
      "IndexNow submission accepted",
    );
  });

  // A 6pm-8pm ET event ends at midnight UTC. Cutting the day in UTC kept it
  // eligible until 8pm ET the following day.
  it("drops an evening event once its New York day is over", async () => {
    const eveningEvent = buildEvent({
      start: dayjs("2026-09-17T22:00:00Z"),
      end: dayjs("2026-09-18T00:00:00Z"),
    });
    const submitAt = async (nowIso: string) => {
      const { service, fetchImpl } = createHarness([], { key: KEY }, nowIso);

      await service.submitCalendarDiff([eveningEvent]);

      return fetchImpl.mock.calls.length;
    };

    // 8:30pm ET on the event day: still published.
    expect(await submitAt("2026-09-18T00:30:00Z")).toBe(1);
    // 11pm ET on the event day.
    expect(await submitAt("2026-09-18T03:00:00Z")).toBe(1);
    // 1am ET the next day: the event day is over.
    expect(await submitAt("2026-09-18T05:00:00Z")).toBe(0);
    // 7pm ET the next day, when a UTC cutoff would still have counted it.
    expect(await submitAt("2026-09-18T23:00:00Z")).toBe(0);
  });

  it("uses the venue zone for an all-day visibility cutoff", async () => {
    const allDayEvent = buildEvent({
      allDay: true,
      start: dayjs("2026-09-26T00:00:00Z"),
      end: dayjs("2026-09-27T00:00:00Z"),
      location: "The Fillmore, 1805 Geary Blvd, San Francisco, CA",
      address: "The Fillmore, 1805 Geary Blvd, San Francisco, CA",
    });
    const submitAt = async (nowIso: string) => {
      const { service, fetchImpl } = createHarness([], { key: KEY }, nowIso);

      await service.submitCalendarDiff([allDayEvent]);

      return fetchImpl.mock.calls.length;
    };

    // 8pm Pacific on the event day: still published.
    expect(await submitAt("2026-09-27T03:00:00Z")).toBe(1);
    // Midnight Pacific: the venue day is over.
    expect(await submitAt("2026-09-27T07:00:00Z")).toBe(0);
  });

  it("ignores events that already ended", async () => {
    const { service, fetchImpl } = createHarness();

    await service.submitCalendarDiff([
      buildEvent({
        start: dayjs("2026-08-20T22:00:00Z"),
        end: dayjs("2026-08-21T00:00:00Z"),
      }),
    ]);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("updates stored fingerprints only after an accepted response", async () => {
    const { service, fetchImpl } = createHarness([respondWith(200)]);

    await service.submitCalendarDiff([buildEvent()]);
    await service.submitCalendarDiff([buildEvent()]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps failed submissions eligible for the next refresh", async () => {
    const { service, fetchImpl, logger } = createHarness([respondWith(403)]);

    await service.submitCalendarDiff([buildEvent()]);
    await service.submitCalendarDiff([buildEvent()]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(submittedUrls(fetchImpl, 0)).toEqual(submittedUrls(fetchImpl, 1));
    expect(logger.error).toHaveBeenCalled();
  });

  it("sends the documented IndexNow request shape", async () => {
    const { service, fetchImpl } = createHarness();

    await service.submitCalendarDiff([buildEvent()]);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.indexnow.org/indexnow");
    expect(init.method).toBe("POST");
    expect(submittedBody(fetchImpl)).toMatchObject({
      host: "samanthadress.com",
      key: KEY,
      keyLocation: `https://samanthadress.com/${KEY}.txt`,
    });
  });
});

describe("IndexNow response handling", () => {
  it.each([200, 202])("treats %i as accepted", async (status) => {
    const { service, fetchImpl, logger } = createHarness([respondWith(status)]);

    await service.submitCalendarDiff([buildEvent()]);
    await service.submitCalendarDiff([buildEvent()]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ status, urlCount: 3 }),
      "IndexNow submission accepted",
    );
  });

  it.each([400, 403, 422, 429])(
    "logs %i without throwing and without retrying",
    async (status) => {
      const { service, fetchImpl, logger } = createHarness([
        respondWith(status, "Too Many Requests"),
      ]);

      await expect(
        service.submitCalendarDiff([buildEvent()]),
      ).resolves.toBeUndefined();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ status }),
        "IndexNow submission rejected",
      );
    },
  );

  it("logs an unexpected body on an accepted response", async () => {
    const { service, logger } = createHarness([
      respondWith(200, "<html>unexpected</html>"),
    ]);

    await service.submitCalendarDiff([buildEvent()]);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ body: "<html>unexpected</html>" }),
      "IndexNow submission accepted with an unexpected response body",
    );
  });

  it("retries once on a server error and keeps the batch eligible", async () => {
    const { service, fetchImpl } = createHarness([
      respondWith(500),
      respondWith(503),
    ]);

    await service.submitCalendarDiff([buildEvent()]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not throw when the request fails at the network level", async () => {
    const { logger } = createHarness();
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.indexnow.org");
    });
    const service = createIndexNowService({
      key: KEY,
      logger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
      retryDelayMs: 0,
    });

    await expect(
      service.submitCalendarDiff([buildEvent()]),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: "getaddrinfo ENOTFOUND api.indexnow.org",
      }),
      "IndexNow submission failed",
    );
  });

  it("never logs the full API key", async () => {
    const { service, logger } = createHarness([
      respondWith(403, `key ${KEY} is not valid`),
    ]);

    await service.submitCalendarDiff([buildEvent()]);

    const loggedText = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);

    expect(loggedText).not.toContain(KEY);
    expect(loggedText).toContain("[redacted]");
  });
});

describe("disabled IndexNow service", () => {
  it("skips every submission when no key is configured", async () => {
    const { service, fetchImpl, logger } = createHarness([], {
      key: undefined,
    });

    expect(service.enabled).toBe(false);

    service.seed([buildEvent()]);
    await service.submitCalendarDiff([buildEvent()]);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
