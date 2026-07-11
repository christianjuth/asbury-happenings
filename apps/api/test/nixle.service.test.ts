import { describe, expect, it } from "vitest";

import dayjs from "../src/calendar/calendar.dates.js";
import type { NixleSourceConfig } from "../src/nixle/nixle.config.js";
import {
  extractNixleMessages,
  nixleMessagesToRss,
} from "../src/nixle/nixle.service.js";

const source: NixleSourceConfig = {
  id: "asbury-park-city",
  name: "City of Asbury Park NJ",
  url: "https://local.nixle.com/city-of-asbury-park-nj/",
  path: "/rss/asbury-park-city.xml",
};

describe("nixle service", () => {
  it("extracts widget messages and approximates entered times rounded to five minutes", () => {
    const messages = extractNixleMessages(
      `
        <div id="message_widget">
          <ol>
            <li class="first">
              <span class="priority community">Community</span>
              <p>First Fridays: Art &amp; Sound Returns <a target="_blank" href="https://nixle.us/HFL39">More&nbsp;»</a></p>
              <p class="time"> "Entered: 4 days, 16 hours ago "</p>
            </li>
            <li>
              <span class="priority advisory">Advisory</span>
              <p>Flood Watch <a target="_blank" href="https://nixle.us/HF96D">More&nbsp;»</a></p>
              <p class="time"> "Entered: 18 minutes ago "</p>
            </li>
            <li class="last"><p><a href="/city-of-asbury-park-nj/">View more</a></p></li>
          </ol>
        </div>
      `,
      source.url,
      dayjs("2026-07-11T13:02:00Z"),
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      title: "First Fridays: Art & Sound Returns",
      link: "https://nixle.us/HFL39",
      priority: "Community",
      enteredText: "4 days, 16 hours ago",
    });
    expect(messages[0]?.publishedAt.toISOString()).toBe(
      "2026-07-06T21:00:00.000Z",
    );
    expect(messages[1]?.publishedAt.toISOString()).toBe(
      "2026-07-11T12:45:00.000Z",
    );
  });

  it("renders extracted messages as RSS", () => {
    const rss = nixleMessagesToRss(
      source,
      [
        {
          title: "First Fridays: Art & Sound Returns",
          link: "https://nixle.us/HFL39",
          priority: "Community",
          enteredText: "18 hours ago",
          publishedAt: dayjs("2026-07-10T19:00:00Z"),
        },
      ],
      dayjs("2026-07-11T13:00:00Z"),
    );

    expect(rss).toContain('<rss version="2.0">');
    expect(rss).toContain("<title>City of Asbury Park NJ Nixle Alerts</title>");
    expect(rss).toContain(
      "<title>First Fridays: Art &amp; Sound Returns</title>",
    );
    expect(rss).toContain("<guid>https://nixle.us/HFL39</guid>");
    expect(rss).toContain(
      "<description>Community | 18 hours ago</description>",
    );
  });
});
