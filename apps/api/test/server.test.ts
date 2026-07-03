import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";

afterEach(() => {
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
          id: "example-events",
          name: "Example Events",
          path: "/calendar/example-events.ics"
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
        }
      ]
    });

    await server.close();
  });

  it("returns plain text debug output from the ics route with debug query", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `
          <article>
            <h2 class="event-title">Query Debug Event</h2>
            <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          </article>
        `
      )
    );

    const server = await buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/calendar/example-events.ics?debug=1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("Calendar: Example Events");
    expect(response.body).toContain("#1 Query Debug Event");

    await server.close();
  });
});
