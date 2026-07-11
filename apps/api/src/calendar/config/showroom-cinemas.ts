import * as cheerio from "cheerio";

import type {
  CalendarEvent,
  CalendarSourceConfig,
  HtmlCalendarSourceConfig,
  SourcePage,
} from "../calendar.types.js";
import type { Dayjs } from "../calendar.dates.js";
import {
  normalizeText,
  parseDateAndTimeOrNull,
  parseDateOrNull,
  resolveOptionalUrl,
} from "../calendar.utils.js";

export const SHOWROOM_CINEMAS_SOURCE = {
  id: "showroom-cinemas",
  name: "ShowRoom Cinemas",
  sourceType: "html",
  url: "https://showroomcinemas.com/coming-soon/",
  containerSelector: ".show-list > .show-details",
  selectors: {
    title: ".show-title .title",
    startDate: {
      selector: ".selected-date span, .no-showtimes-date",
      pattern: /(?:[A-Za-z]{3},\s*)?((?:[A-Za-z]{3}|[A-Za-z]+)\s+\d{1,2})/i,
      format: ["MMM D", "MMMM D"],
    },
    startTime: {
      selector: ".showtime",
      pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
      format: ["h:mm a", "h:mma"],
    },
    description: ".show-content",
    url: {
      selector: ".show-title .title",
      attr: "href",
    },
  },
  timeZone: "America/New_York",
  defaultAddress: "ShowRoom Cinemas, 707 Cookman Avenue, Asbury Park, NJ 07712",
  defaultDurationMinutes: 120,
  extractEvents: extractShowroomComingSoonEvents,
} satisfies CalendarSourceConfig;

function extractShowroomComingSoonEvents(
  html: string,
  config: HtmlCalendarSourceConfig,
  sourcePage: SourcePage,
): CalendarEvent[] {
  // ShowRoom nests multiple dated showtimes inside one movie card, and some cards only
  // expose an "Opens on" date. The generic HTML extractor maps one card to one event.
  const $ = cheerio.load(html);
  const events: CalendarEvent[] = [];

  $(".show-list > .show-details, .show-details").each((_, element) => {
    const container = $(element);
    const title = normalizeText(
      container.find(".show-title .title").first().text(),
    );

    if (!title) {
      return;
    }

    const detailUrl = resolveOptionalUrl(
      container.find(".show-title .title").first().attr("href"),
      sourcePage.sourceUrl,
    );
    const description =
      normalizeText(container.find(".show-content").first().text()) ||
      undefined;
    const address = config.defaultAddress;
    const dateByTimestamp = new Map<string, string>();

    container.find(".datelist .show-date").each((_, dateElement) => {
      const dateItem = $(dateElement);
      const timestamp = normalizeText(dateItem.attr("data-date"));
      const dateText = normalizeShowroomDateText(
        dateItem.find("span").first().text(),
      );

      if (timestamp && dateText) {
        dateByTimestamp.set(timestamp, dateText);
      }
    });

    container.find("ol.showtimes li").each((_, showtimeElement) => {
      const showtimeItem = $(showtimeElement);
      const timestamp = normalizeText(showtimeItem.attr("data-date"));
      const dateText = dateByTimestamp.get(timestamp);
      const timeText = normalizeText(
        showtimeItem.find("a.showtime").first().text(),
      );
      const start = dateText
        ? parseShowroomDateTime(
            dateText,
            timeText,
            config,
            sourcePage.referenceDate,
          )
        : null;

      if (!start) {
        return;
      }

      events.push({
        title,
        start,
        end: start.add(config.defaultDurationMinutes ?? 120, "minute"),
        description,
        location: address,
        address,
        url:
          resolveOptionalUrl(
            showtimeItem.find("a.showtime").first().attr("href"),
            sourcePage.sourceUrl,
          ) ?? detailUrl,
      });
    });

    const opensOnText = normalizeText(
      container.find(".no-showtimes-date").first().text(),
    );
    const opensOnDateText = normalizeShowroomDateText(opensOnText);
    const opensOnDate = opensOnDateText
      ? parseDateOrNull(
          opensOnDateText,
          { selector: ":self", format: ["MMM D", "MMMM D"] },
          undefined,
          sourcePage.referenceDate,
          config.timeZone,
        )
      : null;

    if (opensOnDate) {
      events.push({
        title,
        start: opensOnDate,
        end: opensOnDate.add(1, "day"),
        allDay: true,
        description: description
          ? `Opens on ${opensOnDateText}. ${description}`
          : `Opens on ${opensOnDateText}.`,
        location: address,
        address,
        url: detailUrl,
      });
    }
  });

  return events;
}

function normalizeShowroomDateText(value: string | undefined): string {
  return normalizeText(value).replace(/^(?:Opens on\s+|[A-Za-z]{3},\s*)/i, "");
}

function parseShowroomDateTime(
  dateText: string,
  timeText: string,
  config: HtmlCalendarSourceConfig,
  referenceDate: Dayjs,
): Dayjs | null {
  return parseDateAndTimeOrNull(
    dateText,
    { selector: ":self", format: ["MMM D", "MMMM D"] },
    timeText,
    { selector: ":self", format: ["h:mm a", "h:mma"] },
    undefined,
    undefined,
    referenceDate,
    config.timeZone,
  );
}
