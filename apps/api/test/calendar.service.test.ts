import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCalendarFetchCache,
  extractEventsFromHtml,
  fetchCalendarEvents,
  renderSourceUrl,
  renderSourceUrls,
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

  it("parses Tim McLoone event list cards", () => {
    const timMclooneConfig: CalendarSourceConfig = {
      id: "tim-mcloones-supper-club",
      name: "Tim McLoone's Supper Club",
      url: "https://timmcloonessupperclub.com/events.php",
      containerSelector: ".events_col2",
      selectors: {
        title: "h2 a",
        startDate: {
          selector: ".event_date",
          pattern: /^[A-Za-z]+,\s*(.+)$/,
          format: "MMMM D"
        },
        startTime: {
          selector: ":self",
          pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
          format: ["h:mma", "h:mm a"]
        },
        endTime: {
          selector: ":self",
          pattern: /-\s*([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
          format: ["h:mma", "h:mm a"]
        },
        description: {
          selector: ":self",
          remove: ["h2", ".event_date", "a", ".btn_events"]
        },
        url: {
          selector: "h2 a",
          attr: "href"
        }
      },
      dateFormats: ["MMMM D"],
      timeZone: "America/New_York",
      defaultAddress: "Tim McLoone's Supper Club, 1200 Ocean Avenue, Asbury Park, NJ 07712",
      defaultDurationMinutes: 120
    };

    const events = extractEventsFromHtml(
      `
        <div class="events_col2">
          <div class="event_date">Thursday, July 2</div>
          <h2><a href="events.php?id=7329">Gonzo's Band of Brothers &amp; Sisters SUMMER JAM!</a></h2>
          <div class="event_subtitle"><h3>featuring Layonne Holmes &amp; Reagan Richards</h3></div>
          <div>7:00pm</div>
          <a href="events.php?id=7329"><div class="btn_events">DETAILS</div></a>
        </div>
        <div class="events_col2">
          <div class="event_date">Friday, July 3</div>
          <h2><a href="events.php?id=7430">Asbury Park Fireworks w/ Shore Thing!</a></h2>
          <div>No Cover Charge. Reservations through OpenTable. Click "Tickets" to Reserve!, 6:00pm - 10:00pm</div>
          <a href="events.php?id=7430"><div class="btn_events">DETAILS</div></a>
        </div>
        <div class="events_col2">
          <div class="event_date">Tuesday, July 7</div>
          <h2><a href="events.php?id=7441">Bob Egan's 'Piano Party'</a></h2>
          <div>NO COVER CHARGE!, 6:30pm - 8:30pm</div>
          <a href="events.php?id=7441"><div class="btn_events">DETAILS</div></a>
        </div>
        <div class="events_col2">
          <div class="event_date">Thursday, July 9</div>
          <h2><a href="events.php?id=6797">A Medium Gallery with Linda Shields</a></h2>
          <div class="event_subtitle"><h3>"THE JERSEY SHORE MEDIUM"</h3></div>
          <a href="events.php?id=6797"><div class="btn_events">DETAILS</div></a>
        </div>
      `,
      timMclooneConfig,
      "https://timmcloonessupperclub.com/events.php",
      new Date("2026-07-03T00:00:00Z")
    );

    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({
      title: "Gonzo's Band of Brothers & Sisters SUMMER JAM!",
      description: "featuring Layonne Holmes & Reagan Richards 7:00pm",
      address: "Tim McLoone's Supper Club, 1200 Ocean Avenue, Asbury Park, NJ 07712",
      location: "Tim McLoone's Supper Club, 1200 Ocean Avenue, Asbury Park, NJ 07712",
      url: "https://timmcloonessupperclub.com/events.php?id=7329"
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-02T23:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-03T01:00:00.000Z");
    expect(events[1]?.title).toBe("Asbury Park Fireworks w/ Shore Thing!");
    expect(events[1]?.start.toISOString()).toBe("2026-07-03T22:00:00.000Z");
    expect(events[1]?.end.toISOString()).toBe("2026-07-04T02:00:00.000Z");
    expect(events[2]?.title).toBe("Bob Egan's 'Piano Party'");
    expect(events[2]?.start.toISOString()).toBe("2026-07-07T22:30:00.000Z");
    expect(events[2]?.end.toISOString()).toBe("2026-07-08T00:30:00.000Z");
    expect(events[3]?.title).toBe("A Medium Gallery with Linda Shields");
    expect(events[3]?.start.toISOString()).toBe("2026-07-09T04:00:00.000Z");
    expect(events[3]?.end.toISOString()).toBe("2026-07-09T06:00:00.000Z");
  });

  it("parses R Bar Squarespace event list cards", () => {
    const rBarConfig: CalendarSourceConfig = {
      id: "r-bar",
      name: "R Bar",
      url: "https://www.itsrbar.com/events",
      containerSelector: "article.eventlist-event",
      selectors: {
        title: ".eventlist-title-link",
        startDate: {
          selector: "time.event-date",
          attr: "datetime",
          format: "YYYY-MM-DD"
        },
        startTime: {
          selector: ".event-time-localized-start",
          format: ["h:mm A", "h:mm a"]
        },
        endTime: {
          selector: ".event-time-localized-end",
          format: ["h:mm A", "h:mm a"]
        },
        description: ".eventlist-excerpt, .eventlist-description",
        url: {
          selector: ".eventlist-title-link",
          attr: "href"
        }
      },
      timeZone: "America/New_York",
      defaultAddress: "R Bar & Restaurant, 1114 Main St, Asbury Park, NJ 07712",
      defaultDurationMinutes: 180
    };

    const events = extractEventsFromHtml(
      `
        <article class="eventlist-event eventlist-event--upcoming">
          <h1 class="eventlist-title">
            <a href="/events/high-standards-trio" class="eventlist-title-link">High Standards Trio</a>
          </h1>
          <ul class="eventlist-meta event-meta">
            <li class="eventlist-meta-date">
              <time class="event-date" datetime="2026-07-02">Thursday, July 2, 2026</time>
            </li>
            <li class="eventlist-meta-time">
              <span class="event-time-localized">
                <time class="event-time-localized-start" datetime="2026-07-02">6:00 PM</time>
                <time class="event-time-localized-end" datetime="2026-07-02">9:00 PM</time>
              </span>
            </li>
          </ul>
          <div class="eventlist-description"></div>
          <a href="/events/high-standards-trio" class="eventlist-button">View Event</a>
        </article>
        <article class="eventlist-event eventlist-event--upcoming">
          <h1 class="eventlist-title">
            <a href="/events/2026/6/23/ocean-avenue-swingers" class="eventlist-title-link">4th of July High Standard Stomp Off</a>
          </h1>
          <ul class="eventlist-meta event-meta">
            <li class="eventlist-meta-date">
              <time class="event-date" datetime="2026-07-04">Saturday, July 4, 2026</time>
            </li>
            <li class="eventlist-meta-time">
              <span class="event-time-localized">
                <time class="event-time-localized-start" datetime="2026-07-04">2:00 PM</time>
                <time class="event-time-localized-end" datetime="2026-07-04">5:00 PM</time>
              </span>
            </li>
          </ul>
          <div class="eventlist-excerpt">
            <p>R Bar Presents R Yard Saturdays A High Standard Stomp Off</p>
            <p>No cover</p>
          </div>
          <a href="/events/2026/6/23/ocean-avenue-swingers" class="eventlist-button">View Event</a>
        </article>
      `,
      rBarConfig,
      "https://www.itsrbar.com/events",
      new Date("2026-07-03T00:00:00Z")
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      title: "High Standards Trio",
      address: "R Bar & Restaurant, 1114 Main St, Asbury Park, NJ 07712",
      location: "R Bar & Restaurant, 1114 Main St, Asbury Park, NJ 07712",
      url: "https://www.itsrbar.com/events/high-standards-trio"
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-02T22:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-03T01:00:00.000Z");
    expect(events[1]?.description).toBe("R Bar Presents R Yard Saturdays A High Standard Stomp Off No cover");
    expect(events[1]?.start.toISOString()).toBe("2026-07-04T18:00:00.000Z");
    expect(events[1]?.end.toISOString()).toBe("2026-07-04T21:00:00.000Z");
  });
});

describe("renderSourceUrl", () => {
  it("replaces year and zero-padded month tokens", () => {
    expect(renderSourceUrl("https://example.com/{year}/{month}", new Date("2026-07-03T00:00:00Z"))).toBe(
      "https://example.com/2026/07"
    );
  });

  it("renders this month and next month when template contains month token", () => {
    expect(renderSourceUrls("https://example.com/{year}/{month}", new Date("2026-12-03T00:00:00Z"))).toEqual([
      "https://example.com/2026/12",
      "https://example.com/2027/01",
      "https://example.com/2027/02"
    ]);
  });

  it("renders one source URL when template has no month token", () => {
    expect(renderSourceUrls("https://example.com/events", new Date("2026-07-03T00:00:00Z"))).toEqual([
      "https://example.com/events"
    ]);
  });
});

describe("fetchCalendarEvents", () => {
  it("caches upstream HTML for repeated calendar requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        `
          <article>
            <h2 class="event-title">Cached Event</h2>
            <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          </article>
        `
      )
    );
    const noTokenConfig: CalendarSourceConfig = {
      ...config,
      url: "https://example.com/events"
    };

    const first = await fetchCalendarEvents(noTokenConfig, new Date("2026-07-03T00:00:00Z"));
    const second = await fetchCalendarEvents(noTokenConfig, new Date("2026-07-03T00:00:00Z"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.cacheStatus).toBe("miss");
    expect(second.cacheStatus).toBe("hit");
    expect(second.events[0]?.title).toBe("Cached Event");
  });

  it("fetches this month and the next two months when URL has month token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const title = url.endsWith("/09")
        ? "Third Month Event"
        : url.endsWith("/08")
          ? "Next Month Event"
          : "This Month Event";

      return new Response(
        `
          <article>
            <h2 class="event-title">${title}</h2>
            <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          </article>
        `
      );
    });

    const result = await fetchCalendarEvents(config, new Date("2026-07-03T00:00:00Z"));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.sourceUrls).toEqual([
      "https://example.com/events/2026/07",
      "https://example.com/events/2026/08",
      "https://example.com/events/2026/09"
    ]);
    expect(result.cacheStatuses).toEqual(["miss", "miss", "miss"]);
    expect(result.events.map((event) => event.title)).toEqual([
      "This Month Event",
      "Next Month Event",
      "Third Month Event"
    ]);
  });

  it("fetches one URL when URL has no month token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `
          <article>
            <h2 class="event-title">Single URL Event</h2>
            <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          </article>
        `
      )
    );

    const noTokenConfig: CalendarSourceConfig = {
      ...config,
      url: "https://example.com/events"
    };
    const result = await fetchCalendarEvents(noTokenConfig, new Date("2026-07-03T00:00:00Z"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.sourceUrls).toEqual(["https://example.com/events"]);
    expect(result.events[0]?.title).toBe("Single URL Event");
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
      url: "https://example.com/events",
      cacheTtlSeconds: 0
    };

    await fetchCalendarEvents(noCacheConfig, new Date("2026-07-03T00:00:00Z"));
    const stale = await fetchCalendarEvents(noCacheConfig, new Date("2026-07-03T00:00:00Z"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stale.cacheStatus).toBe("stale");
    expect(stale.events[0]?.title).toBe("Stale Event");
  });

  it("stores set-cookie values by host and sends cookie pairs back", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = new Response(
        `
          <article>
            <h2 class="event-title">Cookie Event</h2>
            <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          </article>
        `
      );
      Object.defineProperty(response.headers, "getSetCookie", {
        value: () => ["X_Obolus_Proof=abc123; Path=/; HttpOnly", "source_session=def456; Secure"]
      });

      return response;
    });
    const noCacheConfig: CalendarSourceConfig = {
      ...config,
      url: "https://example.com/events",
      cacheTtlSeconds: 0
    };

    await fetchCalendarEvents(noCacheConfig, new Date("2026-07-03T00:00:00Z"));
    await fetchCalendarEvents(noCacheConfig, new Date("2026-07-03T00:00:00Z"));

    const secondRequestHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;

    expect(secondRequestHeaders.cookie).toBe("X_Obolus_Proof=abc123; source_session=def456");
  });

  it("does not send cookies across source hosts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = new Response(
        `
          <article>
            <h2 class="event-title">Host Event</h2>
            <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          </article>
        `,
        {
          headers: {
            "set-cookie": "source_session=example-cookie; Path=/"
          }
        }
      );

      return response;
    });
    const exampleConfig: CalendarSourceConfig = {
      ...config,
      url: "https://example.com/events",
      cacheTtlSeconds: 0
    };
    const otherConfig: CalendarSourceConfig = {
      ...config,
      url: "https://events.example.net/events",
      cacheTtlSeconds: 0
    };

    await fetchCalendarEvents(exampleConfig, new Date("2026-07-03T00:00:00Z"));
    await fetchCalendarEvents(otherConfig, new Date("2026-07-03T00:00:00Z"));

    const secondRequestHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;

    expect(secondRequestHeaders.cookie).toBeUndefined();
  });
});
