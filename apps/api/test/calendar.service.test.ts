import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCalendarFetchCache,
  extractEventsFromHtml,
  fetchCalendarEvents,
  renderSourceUrl,
  type CalendarSourceConfig
} from "../src/calendar/calendar.service.js";

afterEach(() => {
  clearCalendarFetchCache();
  vi.restoreAllMocks();
});

const config: CalendarSourceConfig = {
  id: "community",
  name: "Community Events",
  url: "https://example.com/events/{year}/{month}",
  containerSelector: "article",
  selectors: {
    title: ".event-title",
    start: {
      selector: "time.start",
      attr: "datetime",
      format: "YYYY-MM-DDTHH:mm:ss[Z]"
    },
    end: {
      selector: "time.end",
      attr: "datetime",
      format: "YYYY-MM-DDTHH:mm:ss[Z]"
    },
    description: ".description",
    location: ".location",
    url: {
      selector: "a.details",
      attr: "href"
    }
  }
};

describe("extractEventsFromHtml", () => {
  it("extracts events from configured containers and selectors", () => {
    const events = extractEventsFromHtml(
      `
        <article>
          <h2 class="event-title"> First Event </h2>
          <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          <time class="end" datetime="2026-07-04T19:30:00Z">7:30 PM</time>
          <p class="description"> Fireworks and food. </p>
          <span class="location">Town Green</span>
          <a class="details" href="/events/first">Details</a>
        </article>
        <article>
          <h2 class="event-title">Second Event</h2>
          <time class="start" datetime="2026-07-05T15:00:00Z">July 5</time>
          <time class="end" datetime="2026-07-05T16:00:00Z">4 PM</time>
          <a class="details" href="https://events.example.com/second">Details</a>
        </article>
      `,
      config,
      "https://example.com/events/2026/07"
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      title: "First Event",
      description: "Fireworks and food.",
      location: "Town Green",
      url: "https://example.com/events/first"
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-04T18:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-04T19:30:00.000Z");
    expect(events[1]?.url).toBe("https://events.example.com/second");
  });

  it("skips containers missing required title or start date", () => {
    const events = extractEventsFromHtml(
      `
        <article>
          <h2 class="event-title">No Date</h2>
        </article>
        <article>
          <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
        </article>
      `,
      config,
      "https://example.com/events/2026/07"
    );

    expect(events).toEqual([]);
  });

  it("skips containers with invalid start dates", () => {
    const events = extractEventsFromHtml(
      `
        <article>
          <h2 class="event-title">Bad Date</h2>
          <time class="start" datetime="not-a-date">Nope</time>
        </article>
      `,
      config,
      "https://example.com/events/2026/07"
    );

    expect(events).toEqual([]);
  });

  it("uses default duration when no end selector is configured", () => {
    const noEndConfig: CalendarSourceConfig = {
      ...config,
      selectors: {
        title: ".event-title",
        start: {
          selector: "time.start",
          attr: "datetime"
        }
      },
      defaultDurationMinutes: 45
    };

    const events = extractEventsFromHtml(
      `
        <article>
          <h2 class="event-title">Short Event</h2>
          <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
        </article>
      `,
      noEndConfig,
      "https://example.com/events/2026/07"
    );

    expect(events[0]?.end.toISOString()).toBe("2026-07-04T18:45:00.000Z");
  });

  it("parses compact month and day text with current year", () => {
    const compactDateConfig: CalendarSourceConfig = {
      ...config,
      selectors: {
        title: ".event-title",
        start: ".event-date"
      },
      defaultDurationMinutes: 60
    };

    const events = extractEventsFromHtml(
      `
        <article>
          <h2 class="event-title">Split Date Event</h2>
          <div class="event-date">
            <span>Jul</span>
            <span>02</span>
          </div>
        </article>
      `,
      compactDateConfig,
      "https://example.com/events/2026/07",
      new Date("2026-07-03T00:00:00Z")
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.start.toISOString()).toBe("2026-07-02T00:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-02T01:00:00.000Z");
  });

  it("combines separate date and time selectors from the same details block", () => {
    const detailsConfig: CalendarSourceConfig = {
      ...config,
      selectors: {
        title: ".event-list__title",
        startDate: {
          selector: ".event-list__details",
          pattern: /[A-Za-z]{3},\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
          format: "M/D/YYYY"
        },
        startTime: {
          selector: ".event-list__details",
          pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)\s*-/i,
          format: ["h:mma", "h:mm a"]
        },
        endTime: {
          selector: ".event-list__details",
          pattern: /-\s*([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
          format: ["h:mma", "h:mm a"]
        }
      }
    };

    const events = extractEventsFromHtml(
      `
        <article class="event-list">
          <h2 class="event-list__title">Author Talk</h2>
          <div class="event-list__details">
            Mon, 7/6/2026
            7:00pm - 8:30pm
          </div>
        </article>
      `,
      detailsConfig,
      "https://example.com/events"
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.start.toISOString()).toBe("2026-07-06T19:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-06T20:30:00.000Z");
  });

  it("parses configured local timezone before converting to UTC", () => {
    const easternConfig: CalendarSourceConfig = {
      ...config,
      timeZone: "America/New_York",
      selectors: {
        title: ".event-list__title",
        startDate: {
          selector: ".event-list__details",
          pattern: /[A-Za-z]{3},\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
          format: "M/D/YYYY"
        },
        startTime: {
          selector: ".event-list__details",
          pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)\s*-/i,
          format: ["h:mma", "h:mm a"]
        },
        endTime: {
          selector: ".event-list__details",
          pattern: /-\s*([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
          format: ["h:mma", "h:mm a"]
        }
      }
    };

    const events = extractEventsFromHtml(
      `
        <article class="event-list">
          <h2 class="event-list__title">Author Talk</h2>
          <div class="event-list__details">
            Mon, 7/6/2026
            7:00pm - 8:30pm
          </div>
        </article>
      `,
      easternConfig,
      "https://example.com/events"
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.start.toISOString()).toBe("2026-07-06T23:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-07T00:30:00.000Z");
  });

  it("extracts description from the event container after removing metadata", () => {
    const descriptionConfig: CalendarSourceConfig = {
      ...config,
      selectors: {
        title: ".event-list__title",
        startDate: {
          selector: ".event-list__details",
          pattern: /[A-Za-z]{3},\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
          format: "M/D/YYYY"
        },
        startTime: {
          selector: ".event-list__details",
          pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)\s*-/i,
          format: ["h:mma", "h:mm a"]
        },
        description: {
          selector: ":self",
          remove: [".event-list__title", ".event-list__details", ".event-list__links"]
        },
        url: {
          selector: "a.event-list__links--event",
          attr: "href"
        }
      }
    };

    const events = extractEventsFromHtml(
      `
        <article class="event-list">
          <h2 class="event-list__title">Author Talk</h2>
          <div class="event-list__details">
            Mon, 7/6/2026
            7:00pm - 8:30pm
          </div>
          <p>Meet the author for a reading and conversation.</p>
          <div class="event-list__links">
            <a class="event-list__links--event" href="/events/author-talk">View Event</a>
          </div>
        </article>
      `,
      descriptionConfig,
      "https://example.com/events"
    );

    expect(events[0]?.description).toBe("Meet the author for a reading and conversation.");
    expect(events[0]?.description).not.toContain("Author Talk");
    expect(events[0]?.description).not.toContain("7:00pm");
    expect(events[0]?.description).not.toContain("View Event");
  });

  it("extracts address and uses it as ICS location when no location selector is configured", () => {
    const addressConfig: CalendarSourceConfig = {
      ...config,
      selectors: {
        title: ".event-list__title",
        startDate: {
          selector: ".event-list__details",
          pattern: /[A-Za-z]{3},\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
          format: "M/D/YYYY"
        },
        startTime: {
          selector: ".event-list__details",
          pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)\s*-/i,
          format: ["h:mma", "h:mm a"]
        },
        address: {
          selector: ".event-list__details",
          pattern: /Place:\s*(.+)$/i
        }
      }
    };

    const events = extractEventsFromHtml(
      `
        <article class="event-list">
          <h2 class="event-list__title">Author Talk</h2>
          <div class="event-list__details">
            Mon, 7/6/2026
            7:00pm - 8:30pm
            Place: Asbury Book Cooperative 644A Cookman Ave Asbury Park, NJ 07712
          </div>
        </article>
      `,
      addressConfig,
      "https://example.com/events"
    );

    expect(events[0]?.address).toBe("Asbury Book Cooperative 644A Cookman Ave Asbury Park, NJ 07712");
    expect(events[0]?.location).toBe("Asbury Book Cooperative 644A Cookman Ave Asbury Park, NJ 07712");
  });

  it("uses default address when no address is found", () => {
    const addressConfig: CalendarSourceConfig = {
      ...config,
      defaultAddress: "Asbury Book Cooperative, 644A Cookman Ave, Asbury Park, NJ 07712",
      selectors: {
        title: ".event-list__title",
        startDate: {
          selector: ".event-list__details",
          pattern: /[A-Za-z]{3},\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
          format: "M/D/YYYY"
        },
        startTime: {
          selector: ".event-list__details",
          pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)\s*-/i,
          format: ["h:mma", "h:mm a"]
        },
        address: {
          selector: ".event-list__details",
          pattern: /Place:\s*(.+)$/i
        }
      }
    };

    const events = extractEventsFromHtml(
      `
        <article class="event-list">
          <h2 class="event-list__title">Author Talk</h2>
          <div class="event-list__details">
            Mon, 7/6/2026
            7:00pm - 8:30pm
          </div>
        </article>
      `,
      addressConfig,
      "https://example.com/events"
    );

    expect(events[0]?.address).toBe("Asbury Book Cooperative, 644A Cookman Ave, Asbury Park, NJ 07712");
    expect(events[0]?.location).toBe("Asbury Book Cooperative, 644A Cookman Ave, Asbury Park, NJ 07712");
  });
});

describe("renderSourceUrl", () => {
  it("replaces year and zero-padded month tokens", () => {
    expect(renderSourceUrl("https://example.com/{year}/{month}", new Date("2026-07-03T00:00:00Z"))).toBe(
      "https://example.com/2026/07"
    );
  });
});

describe("fetchCalendarEvents", () => {
  it("caches upstream HTML for repeated calendar requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `
          <article>
            <h2 class="event-title">Cached Event</h2>
            <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          </article>
        `
      )
    );

    const first = await fetchCalendarEvents(config, new Date("2026-07-03T00:00:00Z"));
    const second = await fetchCalendarEvents(config, new Date("2026-07-03T00:00:00Z"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.cacheStatus).toBe("miss");
    expect(second.cacheStatus).toBe("hit");
    expect(second.events[0]?.title).toBe("Cached Event");
  });

  it("serves stale cached HTML when upstream starts failing", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          `
            <article>
              <h2 class="event-title">Stale Event</h2>
              <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
            </article>
          `
        )
      )
      .mockResolvedValueOnce(new Response("Too many requests", { status: 429 }));

    const noCacheConfig: CalendarSourceConfig = {
      ...config,
      cacheTtlSeconds: 0
    };

    await fetchCalendarEvents(noCacheConfig, new Date("2026-07-03T00:00:00Z"));
    const stale = await fetchCalendarEvents(noCacheConfig, new Date("2026-07-03T00:00:00Z"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stale.cacheStatus).toBe("stale");
    expect(stale.events[0]?.title).toBe("Stale Event");
  });
});
