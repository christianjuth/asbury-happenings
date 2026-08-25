import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCalendarPageCache,
  getCachedCalendarDebugText,
  warmCalendarPage,
} from "../src/calendar/calendar.cache.js";
import {
  CALENDAR_SOURCES,
  getCalendarSource,
} from "../src/calendar/calendar.config.js";
import dayjs from "../src/calendar/calendar.dates.js";
import { clearCalendarFetchState } from "../src/calendar/calendar.service.js";
import { clearNixleRssCache } from "../src/nixle/nixle.cache.js";
import { buildServer } from "../src/server.js";

afterEach(() => {
  clearCalendarPageCache();
  clearCalendarFetchState();
  clearNixleRssCache();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("server", () => {
  it("returns health status", async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
    });

    await server.close();
  });

  it("lists configured calendars", async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/calendar",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      calendars: [
        {
          id: "asbury-brickwall",
          name: "Brickwall",
          path: "/calendar/asbury-brickwall.ics",
        },
        {
          id: "asbury-lovesick",
          name: "Lovesick",
          path: "/calendar/asbury-lovesick.ics",
        },
        {
          id: "stone-pony",
          name: "The Stone Pony",
          path: "/calendar/stone-pony.ics",
        },
        {
          id: "uncorked-wine-inspired",
          name: "Uncorked Wine Inspired",
          path: "/calendar/uncorked-wine-inspired.ics",
        },
        {
          id: "asbury-book-coop",
          name: "Asbury Book Coop",
          path: "/calendar/asbury-book-coop.ics",
        },
        {
          id: "tim-mcloones-supper-club",
          name: "Tim McLoone's Supper Club",
          path: "/calendar/tim-mcloones-supper-club.ics",
        },
        {
          id: "ap-rooftop",
          name: "AP Rooftop",
          path: "/calendar/ap-rooftop.ics",
        },
        {
          id: "iron-whale",
          name: "Iron Whale",
          path: "/calendar/iron-whale.ics",
        },
        {
          id: "r-bar",
          name: "R Bar",
          path: "/calendar/r-bar.ics",
        },
        {
          id: "wonder-bar",
          name: "Wonder Bar",
          path: "/calendar/wonder-bar.ics",
        },
        {
          id: "pnc-bank-arts-center",
          name: "PNC Bank Arts Center",
          path: "/calendar/pnc-bank-arts-center.ics",
        },
        {
          id: "house-of-independents",
          name: "House of Independents",
          path: "/calendar/house-of-independents.ics",
        },
        {
          id: "showroom-cinemas",
          name: "ShowRoom Cinemas",
          path: "/calendar/showroom-cinemas.ics",
        },
        {
          id: "art629",
          name: "art629 Gallery",
          path: "/calendar/art629.ics",
        },
        {
          id: "asbury-park-brewery",
          name: "Asbury Park Brewery",
          path: "/calendar/asbury-park-brewery.ics",
        },
        {
          id: "black-swan",
          name: "The Black Swan Public House",
          path: "/calendar/black-swan.ics",
        },
        {
          id: "asbury-lanes",
          name: "Asbury Lanes / Hotel",
          path: "/calendar/asbury-lanes.ics",
        },
        {
          id: "asbury-park-city",
          name: "City of Asbury Park",
          path: "/calendar/asbury-park-city.ics",
        },
        {
          id: "status",
          name: "Calendar Status",
          path: "/calendar/status.ics",
        },
      ],
    });

    await server.close();
  });

  it("returns cached current and future events by calendar resource", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T16:00:00.000Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:past
SUMMARY:Past Event
DTSTART;TZID=America/New_York:20260703T100000
DTEND;TZID=America/New_York:20260703T110000
END:VEVENT
BEGIN:VEVENT
UID:just-ended
SUMMARY:Just Ended
DTSTART;TZID=America/New_York:20260703T110000
DTEND;TZID=America/New_York:20260703T120000
END:VEVENT
BEGIN:VEVENT
UID:ongoing
SUMMARY:Ongoing Event
DTSTART;TZID=America/New_York:20260703T113000
DTEND;TZID=America/New_York:20260703T123000
LOCATION:Asbury Lanes
URL:https://example.com/ongoing
END:VEVENT
BEGIN:VEVENT
UID:future
SUMMARY:Future Event
DTSTART;TZID=America/New_York:20260703T180000
DTEND;TZID=America/New_York:20260703T200000
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:all-day
SUMMARY:All Day Event
DTSTART;VALUE=DATE:20260703
DTEND;VALUE=DATE:20260704
END:VEVENT
BEGIN:VEVENT
UID:all-day-no-end
SUMMARY:All Day Without End
DTSTART;VALUE=DATE:20260704
END:VEVENT
BEGIN:VEVENT
UID:filtered
SUMMARY:Open Bowling
DTSTART;TZID=America/New_York:20260704T100000
DTEND;TZID=America/New_York:20260704T110000
END:VEVENT
END:VCALENDAR
`),
    );
    const config = getCalendarSource("asbury-lanes");

    if (!config) {
      throw new Error("Missing Asbury Lanes calendar config");
    }

    await warmCalendarPage(config, 0, dayjs());

    const server = await buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/calendar/events?date=2026-07-03",
    });
    const payload = response.json<{
      date: string;
      generatedAt: string;
      resources: {
        id: string;
        name: string;
        timeZone: string;
        loading: boolean;
        ready: boolean;
        subscriptionPath: string;
      }[];
      events: {
        id: string;
        resourceId: string;
        title: string;
        start: string;
        end: string;
        allDay: boolean;
        status?: string;
      }[];
    }>();

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(payload.date).toBe("2026-07-03");
    expect(payload.generatedAt).toBe("2026-07-03T16:00:00.000Z");
    expect(payload.resources).toHaveLength(CALENDAR_SOURCES.length);
    expect(payload.resources).toContainEqual({
      id: "asbury-lanes",
      name: "Asbury Lanes / Hotel",
      timeZone: "America/New_York",
      loading: false,
      ready: true,
      subscriptionPath: "/calendar/asbury-lanes.ics",
    });
    expect(
      payload.resources.find((resource) => resource.id === "stone-pony"),
    ).toMatchObject({ loading: true, ready: false });
    expect(payload.events.map((event) => event.title)).toEqual([
      "All Day Event",
      "Past Event",
      "Just Ended",
      "Ongoing Event",
      "Future Event",
    ]);
    expect(payload.events).toContainEqual(
      expect.objectContaining({
        resourceId: "asbury-lanes",
        title: "Ongoing Event",
        start: "2026-07-03T15:30:00.000Z",
        end: "2026-07-03T16:30:00.000Z",
        allDay: false,
      }),
    );
    expect(payload.events).toContainEqual(
      expect.objectContaining({
        title: "All Day Event",
        start: "2026-07-03",
        end: "2026-07-04",
        allDay: true,
      }),
    );
    expect(payload.events).toContainEqual(
      expect.objectContaining({
        title: "Future Event",
        status: "cancelled",
      }),
    );
    expect(new Set(payload.events.map((event) => event.id)).size).toBe(
      payload.events.length,
    );
    expect(
      payload.events.every((event) => event.id.startsWith("asbury-lanes:")),
    ).toBe(true);

    const nextDayResponse = await server.inject({
      method: "GET",
      url: "/calendar/events?date=2026-07-04",
    });
    const nextDayPayload = nextDayResponse.json<{
      date: string;
      events: { title: string; start: string; end: string }[];
    }>();

    expect(nextDayResponse.statusCode).toBe(200);
    expect(nextDayPayload.date).toBe("2026-07-04");
    expect(nextDayPayload.events).toEqual([
      expect.objectContaining({
        title: "All Day Without End",
        start: "2026-07-04",
        end: "2026-07-05",
      }),
    ]);

    const invalidDateResponse = await server.inject({
      method: "GET",
      url: "/calendar/events?date=2026-07-40",
    });

    expect(invalidDateResponse.statusCode).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await server.close();
  });

  it("returns plain text debug output from the ics route with debug query", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          `
          <div class="events_col2">
            <div class="event_date">Saturday, July 4</div>
            <h2><a href="events.php?id=1">Query Debug Event</a></h2>
            <div>6:00pm - 8:00pm</div>
          </div>
        `,
        ),
    );

    const server = await buildServer();
    const config = getCalendarSource("tim-mcloones-supper-club");

    if (!config) {
      throw new Error("Missing test calendar config");
    }

    await warmCalendarPage(config, 0, dayjs("2026-07-03T00:00:00Z"));

    const response = await server.inject({
      method: "GET",
      url: "/calendar/tim-mcloones-supper-club.ics?debug=1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("Calendar: Tim McLoone's Supper Club");
    expect(response.body).toContain("Fetch: upstream fetched");
    expect(response.body).toContain("Pages:\n1. fetch fetched | snapshot ");
    expect(response.body).toContain(" | revalidate fresh until ");
    expect(response.body).toContain("#1 Query Debug Event");

    await server.close();
  });

  it("shows when cached calendar snapshots are past the revalidate window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T00:00:00Z"));
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          `
          <div class="events_col2">
            <div class="event_date">Saturday, July 4</div>
            <h2><a href="events.php?id=1">Stale Debug Event</a></h2>
            <div>6:00pm - 8:00pm</div>
          </div>
        `,
        ),
    );
    const config = getCalendarSource("tim-mcloones-supper-club");

    if (!config) {
      throw new Error("Missing test calendar config");
    }

    await warmCalendarPage(config, 0, dayjs("2026-07-03T00:00:00Z"));

    const freshDebugText = getCachedCalendarDebugText(
      config,
      undefined,
      dayjs("2026-07-03T00:29:59Z"),
    );
    const dueDebugText = getCachedCalendarDebugText(
      config,
      undefined,
      dayjs("2026-07-03T00:30:00Z"),
    );

    expect(freshDebugText).toContain(
      "1. fetch fetched | snapshot 2026-07-03T00:00:00.000Z | revalidate fresh until 2026-07-03T00:30:00.000Z",
    );
    expect(dueDebugText).toContain(
      "1. fetch fetched | snapshot 2026-07-03T00:00:00.000Z | revalidate due since 2026-07-03T00:30:00.000Z",
    );
  });

  it("keeps the last parsed calendar snapshot when a refresh fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          `
            <div class="events_col2">
              <div class="event_date">Saturday, July 4</div>
              <h2><a href="events.php?id=1">Last Good Event</a></h2>
              <div>6:00pm - 8:00pm</div>
            </div>
          `,
        ),
      )
      .mockResolvedValueOnce(
        new Response("Too many requests", { status: 429 }),
      );
    const config = getCalendarSource("tim-mcloones-supper-club");

    if (!config) {
      throw new Error("Missing test calendar config");
    }

    await warmCalendarPage(config, 0, dayjs("2026-07-03T00:00:00Z"));
    await warmCalendarPage(config, 0, dayjs("2026-07-03T00:00:00Z"));

    const debugText = getCachedCalendarDebugText(
      config,
      undefined,
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(debugText).toContain("1. fetch stale | snapshot ");
    expect(debugText).toContain("revalidate error");
    expect(debugText).toContain("Last Good Event");
  });

  it("returns an empty status calendar when no calendar has failed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T00:00:00Z"));
    const server = await buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/calendar/status.ics",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/calendar");
    expect(response.body).toContain("BEGIN:VCALENDAR");
    expect(response.body).not.toContain("BEGIN:VEVENT");

    await server.close();
  });

  it("returns a status event when a calendar source fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T00:00:00Z"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Too many requests", { status: 429 }),
    );
    const server = await buildServer();
    const config = getCalendarSource("tim-mcloones-supper-club");

    if (!config) {
      throw new Error("Missing test calendar config");
    }

    await warmCalendarPage(config, 0, dayjs("2026-07-03T00:00:00Z"));

    const feedResponse = await server.inject({
      method: "GET",
      url: "/calendar/status.ics",
    });
    const debugResponse = await server.inject({
      method: "GET",
      url: "/calendar/status.ics?debug=1",
    });

    expect(feedResponse.statusCode).toBe(200);
    expect(feedResponse.body).toContain("SUMMARY:Error: 1 calendar failing");
    expect(feedResponse.body).toContain("DTSTART;VALUE=DATE:20260703");
    expect(feedResponse.body).toContain("DTEND;VALUE=DATE:20260704");
    expect(feedResponse.body).toContain("Tim McLoone's Supper Club");
    expect(feedResponse.body).toContain("Status:");
    expect(feedResponse.body).toContain("error");
    expect(feedResponse.body).toContain("Error: Failed");
    expect(feedResponse.body).toContain(
      "to fetch https://timmcloonessupperclub.com/events.php: 429",
    );
    expect(debugResponse.statusCode).toBe(200);
    expect(debugResponse.headers["content-type"]).toContain("text/plain");
    expect(debugResponse.body).toContain("Calendar: Calendar Status");
    expect(debugResponse.body).toContain("Events: 1");
    expect(debugResponse.body).toContain("Status: error");

    await server.close();
  });

  it("filters cached calendar events from repeated filter query params", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          `
          <div class="events_col2">
            <div class="event_date">Saturday, July 4</div>
            <h2><a href="events.php?id=1">Query Debug Event</a></h2>
            <div>6:00pm - 8:00pm</div>
          </div>
          <div class="events_col2">
            <div class="event_date">Saturday, July 4</div>
            <h2><a href="events.php?id=2">Other Debug Event</a></h2>
            <div>6:00pm - 8:00pm</div>
          </div>
        `,
        ),
    );

    const server = await buildServer();
    const config = getCalendarSource("tim-mcloones-supper-club");

    if (!config) {
      throw new Error("Missing test calendar config");
    }

    await warmCalendarPage(config, 0, dayjs("2026-07-03T00:00:00Z"));

    const response = await server.inject({
      method: "GET",
      url: "/calendar/tim-mcloones-supper-club.ics?debug=1&filter=debug&filter=!other",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Events: 1");
    expect(response.body).toContain("Query Debug Event");
    expect(response.body).not.toContain("Other Debug Event");

    await server.close();
  });

  it("supports calendar CORS preflight", async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: "OPTIONS",
      url: "/calendar/asbury-book-coop.ics",
      headers: {
        origin: "http://localhost:3100",
        "access-control-request-method": "GET",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toBe(
      "GET, OPTIONS",
    );
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3100",
    );

    await server.close();
  });

  it("advertises only ICS calendar routes", async () => {
    const server = await buildServer();

    const index = await server.inject({ method: "GET", url: "/calendar" });

    expect(index.statusCode).toBe(200);

    const { calendars } = index.json<{
      calendars: Record<string, unknown>[];
    }>();

    expect(calendars.length).toBeGreaterThan(1);
    // Assert the key set per entry rather than searching the payload for a
    // substring: a future `jsonPath` fails this, and a calendar id that merely
    // contains "json" does not.
    for (const calendar of calendars) {
      expect(Object.keys(calendar).sort()).toEqual(["id", "name", "path"]);
      expect(calendar["path"]).toMatch(/\.ics$/);
    }

    const response = await server.inject({
      method: "GET",
      url: "/calendar/stone-pony.json",
    });

    expect(response.statusCode).toBe(404);

    await server.close();
  });

  it("lists configured Nixle RSS feeds", async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/rss",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      feeds: [
        {
          id: "asbury-park-city",
          name: "City of Asbury Park NJ",
          path: "/rss/asbury-park-city.xml",
        },
        {
          id: "asbury-park-police",
          name: "Asbury Park Police Department",
          path: "/rss/asbury-park-police.xml",
        },
      ],
    });

    await server.close();
  });

  it("serves Nixle RSS feeds from a short in-memory cache", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`
        <div id="message_widget">
          <ol>
            <li>
              <span class="priority community">Community</span>
              <p>First Fridays <a href="https://nixle.us/HFL39">More&nbsp;»</a></p>
              <p class="time"> "Entered: 18 hours ago "</p>
            </li>
          </ol>
        </div>
      `),
    );
    const server = await buildServer();

    const firstResponse = await server.inject({
      method: "GET",
      url: "/rss/asbury-park-city.xml",
    });
    const secondResponse = await server.inject({
      method: "GET",
      url: "/rss/asbury-park-city.xml",
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.headers["content-type"]).toContain(
      "application/rss+xml",
    );
    expect(firstResponse.body).toContain(
      "<title>City of Asbury Park NJ Nixle Alerts</title>",
    );
    expect(firstResponse.body).toContain("<title>First Fridays</title>");
    expect(secondResponse.body).toBe(firstResponse.body);
    expect(fetch).toHaveBeenCalledTimes(1);

    await server.close();
  });
});
