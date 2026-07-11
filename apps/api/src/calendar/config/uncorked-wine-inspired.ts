import * as cheerio from "cheerio";
import _ from "lodash";

import type {
  CalendarEvent,
  CalendarSourceConfig,
  HtmlCalendarSourceConfig,
  SourcePage,
} from "../calendar.types.js";
import {
  normalizeText,
  parseWithOptionalTimeZone,
  resolveOptionalUrl,
} from "../calendar.utils.js";

export const UNCORKED_WINE_INSPIRED_SOURCE = {
  id: "uncorked-wine-inspired",
  name: "Uncorked Wine Inspired",
  sourceType: "html",
  url: "https://uncorkedwineinspired.com/wp-content/plugins/eventbook/calendar-grid.php",
  containerSelector: ".grid-box",
  selectors: {
    title: "h2",
    start: {
      selector: ".block > div:nth-child(2) > p:nth-of-type(2)",
      pattern: /^([A-Z]+ \d{2}, \d{4} AT \d{1,2}:\d{2}[AP]M)/,
      format: "MMMM DD, YYYY [AT] h:mmA",
    },
    description: ".block > div:nth-child(2) > p:nth-of-type(1)",
    url: {
      selector: "a.btn_info",
      attr: "href",
    },
  },
  timeZone: "America/New_York",
  defaultAddress: "Uncorked Wine Inspired",
  defaultDurationMinutes: 120,
  extractEvents: extractUncorkedWineInspiredEvents,
} satisfies CalendarSourceConfig;

export function extractUncorkedWineInspiredEvents(
  html: string,
  config: HtmlCalendarSourceConfig,
  sourcePage: SourcePage,
): CalendarEvent[] {
  // EventBook emits all-caps month names and mixes price/seat text into the
  // date line, which is easier to normalize here than in generic selectors.
  const $ = cheerio.load(html);
  const events: CalendarEvent[] = [];

  $(config.containerSelector).each((_, element) => {
    const container = $(element);
    const title = normalizeText(container.find("h2").first().text());
    const description =
      normalizeText(container.find("p").first().text()) || undefined;
    const dateLine = normalizeText(
      container
        .find("p")
        .toArray()
        .map((paragraph) => $(paragraph).text())
        .find((value) => /\bAT\s+\d{1,2}:\d{2}[AP]M/i.test(value)),
    );
    const start = parseUncorkedWineInspiredDateTime(dateLine, config.timeZone);

    if (!title || !start) {
      return;
    }

    const address = config.defaultAddress;

    events.push({
      title,
      start,
      end: start.add(config.defaultDurationMinutes ?? 120, "minute"),
      description,
      location: address,
      address,
      url: resolveOptionalUrl(
        container.find("a.btn_info").first().attr("href"),
        sourcePage.sourceUrl,
      ),
    });
  });

  return events;
}

function parseUncorkedWineInspiredDateTime(
  value: string,
  timeZone?: string,
): CalendarEvent["start"] | null {
  const match = value.match(
    /^([A-Z]+)\s+(\d{2}),\s+(\d{4})\s+AT\s+(\d{1,2}:\d{2}[AP]M)/,
  );

  if (!match) {
    return null;
  }

  const [, rawMonth, day, year, time] = match;

  if (!rawMonth || !day || !year || !time) {
    return null;
  }

  const month = _.startCase(rawMonth.toLowerCase());
  const parsed = parseWithOptionalTimeZone(
    `${month} ${day}, ${year} ${time}`,
    "MMMM DD, YYYY h:mmA",
    timeZone,
  );

  return parsed.isValid() ? parsed : null;
}
