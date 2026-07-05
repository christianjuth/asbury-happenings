import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCalendarPageCache, warmCalendarPage } from "../src/calendar/calendar.cache.js";
import { getCalendarSource } from "../src/calendar/calendar.config.js";
import { buildServer } from "../src/server.js";

afterEach(() => {
  clearCalendarPageCache();
  vi.restoreAllMocks();
});

describe("server", () => {
  it("returns health status", async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true
    });

    await server.close();
  });

  it("lists configured calendars", async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/calendar"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      calendars: [
        {
          id: "asbury-brickwall",
          name: "Brickwall",
          path: "/calendar/asbury-brickwall.ics"
        },
        {
          id: "asbury-lovesick",
          name: "Lovesick",
          path: "/calendar/asbury-lovesick.ics"
        },
        {
          id: "stone-pony",
          name: "The Stone Pony",
          path: "/calendar/stone-pony.ics"
        },
        {
          id: "asbury-book-coop",
          name: "Asbury Book Coop",
          path: "/calendar/asbury-book-coop.ics"
        },
        {
          id: "tim-mcloones-supper-club",
          name: "Tim McLoone's Supper Club",
          path: "/calendar/tim-mcloones-supper-club.ics"
        },
        {
          id: "ap-rooftop",
          name: "AP Rooftop",
          path: "/calendar/ap-rooftop.ics"
        },
        {
          id: "r-bar",
          name: "R Bar",
          path: "/calendar/r-bar.ics"
        },
        {
          id: "wonder-bar",
          name: "Wonder Bar",
          path: "/calendar/wonder-bar.ics"
        },
        {
          id: "house-of-independents",
          name: "House of Independents",
          path: "/calendar/house-of-independents.ics"
        },
        {
          id: "showroom-cinemas",
          name: "ShowRoom Cinemas",
          path: "/calendar/showroom-cinemas.ics"
        },
        {
          id: "asbury-park-brewery",
          name: "Asbury Park Brewery",
          path: "/calendar/asbury-park-brewery.ics"
        },
        {
          id: "black-swan",
          name: "The Black Swan Public House",
          path: "/calendar/black-swan.ics"
        },
        {
          id: "asbury-lanes",
          name: "Asbury Lanes / Hotel",
          path: "/calendar/asbury-lanes.ics"
        },
        {
          id: "asbury-park-city",
          name: "City of Asbury Park",
          path: "/calendar/asbury-park-city.ics"
        },
        {
          id: "samantha-dress",
          name: "Samantha Dress",
          path: "/calendar/samantha-dress.ics"
        }
      ]
    });

    await server.close();
  });

  it("returns plain text debug output from the ics route with debug query", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        `
          <div class="events_col2">
            <div class="event_date">Saturday, July 4</div>
            <h2><a href="events.php?id=1">Query Debug Event</a></h2>
            <div>6:00pm - 8:00pm</div>
          </div>
        `
      )
    );

    const server = await buildServer();
    const config = getCalendarSource("tim-mcloones-supper-club");

    if (!config) {
      throw new Error("Missing test calendar config");
    }

    await warmCalendarPage(config, 0, new Date("2026-07-03T00:00:00Z"));

    const response = await server.inject({
      method: "GET",
      url: "/calendar/tim-mcloones-supper-club.ics?debug=1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("Calendar: Tim McLoone's Supper Club");
    expect(response.body).toContain("#1 Query Debug Event");

    await server.close();
  });

  it("filters cached calendar events from repeated filter query params", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
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
        `
      )
    );

    const server = await buildServer();
    const config = getCalendarSource("tim-mcloones-supper-club");

    if (!config) {
      throw new Error("Missing test calendar config");
    }

    await warmCalendarPage(config, 0, new Date("2026-07-03T00:00:00Z"));

    const response = await server.inject({
      method: "GET",
      url: "/calendar/tim-mcloones-supper-club.ics?debug=1&filter=debug&filter=!other"
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
        origin: "https://samanthadress.com"
      }
    });
    const disallowedFeedResponse = await server.inject({
      method: "GET",
      url: "/calendar/asbury-book-coop.ics",
      headers: {
        origin: "https://samanthadress.com"
      }
    });
    const disallowedOriginResponse = await server.inject({
      method: "GET",
      url: "/calendar/samantha-dress.ics",
      headers: {
        origin: "https://example.com"
      }
    });

    expect(allowedResponse.headers["access-control-allow-origin"]).toBe("https://samanthadress.com");
    expect(allowedResponse.headers.vary).toBe("Origin");
    expect(disallowedFeedResponse.headers["access-control-allow-origin"]).toBeUndefined();
    expect(disallowedOriginResponse.headers["access-control-allow-origin"]).toBeUndefined();

    await server.close();
  });

  it("supports Samantha Dress CORS preflight from the configured origin", async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: "OPTIONS",
      url: "/calendar/samantha-dress.ics",
      headers: {
        origin: "https://samanthadress.com",
        "access-control-request-method": "GET"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://samanthadress.com");
    expect(response.headers["access-control-allow-methods"]).toBe("GET, OPTIONS");

    await server.close();
  });
});
