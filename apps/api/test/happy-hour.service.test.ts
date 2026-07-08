import { afterEach, describe, expect, it, vi } from "vitest";

import { clearHappyHourCache, warmHappyHourCache } from "../src/happy-hour/happy-hour.cache.js";
import { HAPPY_HOUR_SOURCE } from "../src/happy-hour/happy-hour.config.js";
import {
  extractHappyHourEvents,
  happyHourEventsToIcs
} from "../src/happy-hour/happy-hour.service.js";
import dayjs from "../src/calendar/calendar.dates.js";
import { buildServer } from "../src/server.js";

afterEach(() => {
  clearHappyHourCache();
  vi.restoreAllMocks();
});

const HAPPY_HOUR_HTML = `
  <section id="restaurant-happy-hours">
    <div class="restaurants">
      <article class="restaurant hh" data-daytimes="1-14 1-15 1-16 5-14 5-15 5-16">
        <header>
          <a href="https://www.aprooftop.com">AP Rooftop</a>
          <a href="tel:+1-732-444-2043">(732) 444-2043</a>
          <div class="verified"><small><em>Verified: <time>2026-06-06</time></em></small></div>
        </header>
        <content>
          <time class="dayhour">Mon-Fri 2pm-5pm</time>
          <ul>
            <li>$5 drafts, $9 wine</li>
            <li>food specials</li>
          </ul>
        </content>
        <footer>
          <a href="https://maps.app.goo.gl/f6RFthcQQrifNNwn8"><img title="Map"></a>
          <a href="https://www.instagram.com/ap.rooftop"><img title="Instagram"></a>
          <a href="/menus/happy-hour.pdf"><img title="Happy Hour Menu"></a>
        </footer>
      </article>
      <article class="restaurant hh">
        <header>
          <a href="https://talulaspizza.com/">Talula's</a>
          <a href="tel:+1-732-455-3003">(732) 455-3003</a>
          <div class="verified"><small><em>Verified: <time>2025-12-17</time></em></small></div>
        </header>
        <content>
          <time class="dayhour">Mon-Thu 4:30pm-6:30pm</time>
          <ul>
            <li>$5 rotating draft</li>
          </ul>
        </content>
        <footer>
          <a href="https://maps.app.goo.gl/NTV7Dkwq2BadhE7MA"><img title="Map"></a>
          <a href="https://www.instagram.com/talulaspizza"><img title="Instagram"></a>
          <a href="https://talulaspizza.com/blogs/events/happy-hour-at-the-bar"><img title="Happy Hour Menu"></a>
        </footer>
      </article>
    </div>
  </section>
`;

describe("extractHappyHourEvents", () => {
  it("expands restaurant day/hour rows into weekly events", () => {
    const events = extractHappyHourEvents(
      HAPPY_HOUR_HTML,
      HAPPY_HOUR_SOURCE,
      dayjs("2026-07-07T12:00:00Z")
    );

    expect(events).toHaveLength(9);
    expect(events[0]).toMatchObject({
      title: "AP Rooftop",
      location: "AP Rooftop",
      scheduleText: "Mon-Fri 2pm-5pm",
      day: 1,
      url: "https://www.aprooftop.com/"
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-06T18:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-06T21:00:00.000Z");
    expect(events[0]?.description).toContain("$5 drafts, $9 wine");
    expect(events[0]?.description).toContain("Verified: 2026-06-06");
    expect(events[0]?.description).toContain("Menu: https://asburypark.rectalogic.com/menus/happy-hour.pdf");

    const talulasMonday = events.find((event) => event.title === "Talula's" && event.day === 1);

    expect(talulasMonday?.start.toISOString()).toBe("2026-07-06T20:30:00.000Z");
    expect(talulasMonday?.end.toISOString()).toBe("2026-07-06T22:30:00.000Z");
  });

  it("serializes happy hours as recurring weekly calendar events", () => {
    const events = extractHappyHourEvents(
      HAPPY_HOUR_HTML,
      HAPPY_HOUR_SOURCE,
      dayjs("2026-07-07T12:00:00Z")
    );
    const feed = happyHourEventsToIcs("Test Happy Hours", events.slice(0, 1));

    expect(feed).toContain("BEGIN:VCALENDAR");
    expect(feed).toContain("SUMMARY:AP Rooftop");
    expect(feed).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
  });
});

describe("happy hour routes", () => {
  it("lists and serves the cached happy hour calendar", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(HAPPY_HOUR_HTML));

    await warmHappyHourCache(HAPPY_HOUR_SOURCE, dayjs("2026-07-07T12:00:00Z"));

    const server = await buildServer();
    const listResponse = await server.inject({
      method: "GET",
      url: "/happy-hours"
    });
    const debugResponse = await server.inject({
      method: "GET",
      url: "/happy-hours/asbury-park.ics?debug=1&filter=talula"
    });
    const feedResponse = await server.inject({
      method: "GET",
      url: "/happy-hours/asbury-park.ics?filter=talula"
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      calendars: [
        {
          id: "asbury-park",
          name: "Asbury Park Happy Hours",
          path: "/happy-hours/asbury-park.ics"
        }
      ]
    });
    expect(debugResponse.statusCode).toBe(200);
    expect(debugResponse.body).toContain("Calendar: Asbury Park Happy Hours");
    expect(debugResponse.body).toContain("Fetch: upstream fetched");
    expect(debugResponse.body).toContain("Events: 4");
    expect(debugResponse.body).toContain("Talula's");
    expect(debugResponse.body).not.toContain("AP Rooftop");
    expect(feedResponse.statusCode).toBe(200);
    expect(feedResponse.headers["content-type"]).toContain("text/calendar");
    expect(feedResponse.body).toContain("SUMMARY:Talula's");

    await server.close();
  });
});
