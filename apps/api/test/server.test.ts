import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCalendarPageCache,
  getCachedCalendarDebugText,
  warmCalendarPage,
} from "../src/calendar/calendar.cache.js";
import { getCalendarSource } from "../src/calendar/calendar.config.js";
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

  it("reports IndexNow and Samantha Dress calendar warm status", async () => {
    const server = await buildServer();

    const coldResponse = await server.inject({
      method: "GET",
      url: "/debug/index-now",
    });

    expect(coldResponse.statusCode).toBe(200);
    expect(coldResponse.json()).toEqual({
      service: "index-now",
      enabled: false,
      calendar: {
        id: "samantha-dress",
        warm: false,
        eventCount: 0,
      },
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        [
          "BEGIN:VCALENDAR",
          "BEGIN:VEVENT",
          "UID:status-event",
          "SUMMARY:Status Event",
          "DTSTART:20260706T190000Z",
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\r\n"),
      ),
    );
    const config = getCalendarSource("samantha-dress");

    if (!config) {
      throw new Error("Missing Samantha Dress calendar config");
    }

    await warmCalendarPage(config, 0, dayjs("2026-07-03T00:00:00Z"));

    const warmResponse = await server.inject({
      method: "GET",
      url: "/debug/index-now",
    });

    expect(warmResponse.json()).toMatchObject({
      calendar: {
        id: "samantha-dress",
        warm: true,
        eventCount: 1,
      },
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
          id: "samantha-dress",
          name: "Samantha Dress",
          path: "/calendar/samantha-dress.ics",
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

  it("allows browser access only for Samantha Dress from the configured origin", async () => {
    const server = await buildServer();

    const allowedResponse = await server.inject({
      method: "GET",
      url: "/calendar/samantha-dress.ics",
      headers: {
        origin: "https://samanthadress.com",
      },
    });
    const disallowedFeedResponse = await server.inject({
      method: "GET",
      url: "/calendar/asbury-book-coop.ics",
      headers: {
        origin: "https://samanthadress.com",
      },
    });
    const disallowedOriginResponse = await server.inject({
      method: "GET",
      url: "/calendar/samantha-dress.ics",
      headers: {
        origin: "https://example.com",
      },
    });

    expect(allowedResponse.headers["access-control-allow-origin"]).toBe(
      "https://samanthadress.com",
    );
    expect(allowedResponse.headers.vary).toBe("Origin");
    expect(
      disallowedFeedResponse.headers["access-control-allow-origin"],
    ).toBeUndefined();
    expect(
      disallowedOriginResponse.headers["access-control-allow-origin"],
    ).toBeUndefined();

    await server.close();
  });

  it("supports Samantha Dress CORS preflight from the configured origin", async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: "OPTIONS",
      url: "/calendar/samantha-dress.ics",
      headers: {
        origin: "https://samanthadress.com",
        "access-control-request-method": "GET",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://samanthadress.com",
    );
    expect(response.headers["access-control-allow-methods"]).toBe(
      "GET, OPTIONS",
    );

    await server.close();
  });

  it("allows Samantha Dress browser access from localhost and Cloudflare Pages branch builds", async () => {
    const server = await buildServer();

    const localhostResponse = await server.inject({
      method: "GET",
      url: "/calendar/samantha-dress.ics",
      headers: {
        origin: "http://localhost:3000",
      },
    });
    const namedBranchBuildResponse = await server.inject({
      method: "GET",
      url: "/calendar/samantha-dress.ics",
      headers: {
        origin: "https://318b4aca.sams-portfolio-6ir.pages.dev",
      },
    });
    const otherBranchBuildResponse = await server.inject({
      method: "GET",
      url: "/calendar/samantha-dress.ics",
      headers: {
        origin: "https://preview.sams-portfolio-6ir.pages.dev",
      },
    });
    const unrelatedPagesResponse = await server.inject({
      method: "GET",
      url: "/calendar/samantha-dress.ics",
      headers: {
        origin: "https://someone-else.pages.dev",
      },
    });
    const nestedSubdomainResponse = await server.inject({
      method: "GET",
      url: "/calendar/samantha-dress.ics",
      headers: {
        origin: "https://evil.318b4aca.sams-portfolio-6ir.pages.dev",
      },
    });

    expect(localhostResponse.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    expect(
      namedBranchBuildResponse.headers["access-control-allow-origin"],
    ).toBe("https://318b4aca.sams-portfolio-6ir.pages.dev");
    expect(
      otherBranchBuildResponse.headers["access-control-allow-origin"],
    ).toBe("https://preview.sams-portfolio-6ir.pages.dev");
    expect(
      unrelatedPagesResponse.headers["access-control-allow-origin"],
    ).toBeUndefined();
    expect(
      nestedSubdomainResponse.headers["access-control-allow-origin"],
    ).toBeUndefined();

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
