import * as cheerio from "cheerio";
import lodash from "lodash";

import {
  normalizeText,
  parseDateAndTimeOrNull,
  parseDateOrNull,
  parseWithOptionalTimeZone,
  resolveOptionalUrl,
} from "./calendar.utils.js";
import type {
  CalendarEvent,
  HtmlCalendarSourceConfig,
  SourcePage,
} from "./calendar.types.js";
import type { Dayjs } from "./calendar.dates.js";

export function stripHtmlFromEventLocation(
  event: CalendarEvent,
): CalendarEvent {
  const location = event.location ? stripHtml(event.location) : event.location;
  const address = event.address ? stripHtml(event.address) : event.address;

  return {
    ...event,
    location,
    address,
  };
}

export function stripHtmlFromEventDescription(
  event: CalendarEvent,
): CalendarEvent {
  const description = event.description
    ? stripHtml(event.description)
    : event.description;

  return {
    ...event,
    description,
  };
}

export function extractShowroomComingSoonEvents(
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

export function extractSmithMadeEvents(
  html: string,
  config: HtmlCalendarSourceConfig,
  sourcePage: SourcePage,
): CalendarEvent[] {
  // Smith Made event cards only render the day number in the listing, so the
  // event month has to come from the rendered source page context. Their time
  // ranges can also omit the start meridiem ("5:00 to 10:00 PM") or cross
  // midnight ("9:00 to 1:00 AM"). Keeping those inferences here avoids making
  // the generic HTML parser guess across all other calendar sources.
  const $ = cheerio.load(html);
  const events: CalendarEvent[] = [];

  $(config.containerSelector).each((_, element) => {
    const container = $(element);
    const title = normalizeText(
      container.find(".event-info h2").first().text(),
    );
    const dayText = normalizeText(
      container.find(".date .type--h2").first().text(),
    );
    const timeText = normalizeText(
      container
        .find(".event-meta div")
        .toArray()
        .map((timeElement) => $(timeElement).text())
        .find((value) => /\d/.test(value) && /\bto\b/i.test(value)),
    );
    const start = parseSmithMadeDateTime(
      dayText,
      timeText,
      sourcePage.referenceDate,
      config.timeZone,
    );

    if (!title || !start) {
      return;
    }

    const end =
      parseSmithMadeEndDateTime(
        dayText,
        timeText,
        start,
        sourcePage.referenceDate,
        config.timeZone,
      ) ?? start.add(config.defaultDurationMinutes ?? 60, "minute");
    const description =
      normalizeText(container.find(".event-description").first().text()) ||
      undefined;
    const locationName = normalizeText(
      container.find(".event-meta a").first().text(),
    );
    const address = config.defaultAddress;

    events.push({
      title,
      start,
      end,
      description,
      location: address ?? locationName,
      address,
      url: sourcePage.sourceUrl,
    });
  });

  return events;
}

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

function stripHtml(value: string): string {
  const $ = cheerio.load(value);

  $("style, script, noscript").remove();
  $("br").replaceWith(" ");
  $("p, div, li, h1, h2, h3, h4, h5, h6").append(" ");

  return normalizeText($.root().text());
}

function normalizeShowroomDateText(value: string | undefined): string {
  return normalizeText(value).replace(/^(?:Opens on\s+|[A-Za-z]{3},\s*)/i, "");
}

function parseUncorkedWineInspiredDateTime(
  value: string,
  timeZone?: string,
): Dayjs | null {
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

  const month = lodash.startCase(rawMonth.toLowerCase());
  const parsed = parseWithOptionalTimeZone(
    `${month} ${day}, ${year} ${time}`,
    "MMMM DD, YYYY h:mmA",
    timeZone,
  );

  return parsed.isValid() ? parsed : null;
}

function parseSmithMadeDateTime(
  dayText: string,
  timeText: string,
  referenceDate: Dayjs,
  timeZone?: string,
): Dayjs | null {
  const timeRange = parseSmithMadeTimeRange(timeText);

  if (!timeRange) {
    const date = parseSmithMadeDate(dayText, referenceDate, timeZone);

    return date;
  }

  return parseSmithMadeLocalDateTime(
    dayText,
    timeRange.startTime,
    referenceDate,
    timeZone,
  );
}

function parseSmithMadeEndDateTime(
  dayText: string,
  timeText: string,
  start: Dayjs,
  referenceDate: Dayjs,
  timeZone?: string,
): Dayjs | null {
  const timeRange = parseSmithMadeTimeRange(timeText);

  if (!timeRange) {
    return null;
  }

  const end = parseSmithMadeLocalDateTime(
    dayText,
    timeRange.endTime,
    referenceDate,
    timeZone,
  );

  if (!end) {
    return null;
  }

  return end.isAfter(start) ? end : end.add(1, "day");
}

function parseSmithMadeTimeRange(
  timeText: string,
): { startTime: string; endTime: string } | null {
  const match = timeText.match(
    /^(\d{1,2}(?::\d{2})?)\s*([AP]M)?\s+to\s+(\d{1,2}(?::\d{2})?)\s*([AP]M)$/i,
  );

  if (!match) {
    return null;
  }

  const [, rawStartTime, rawStartPeriod, rawEndTime, rawEndPeriod] = match;

  if (!rawStartTime || !rawEndTime || !rawEndPeriod) {
    return null;
  }

  const endPeriod = rawEndPeriod.toUpperCase();
  const startPeriod =
    rawStartPeriod?.toUpperCase() ??
    inferSmithMadeStartPeriod(rawStartTime, rawEndTime, endPeriod);

  return {
    startTime: `${rawStartTime} ${startPeriod}`,
    endTime: `${rawEndTime} ${endPeriod}`,
  };
}

function inferSmithMadeStartPeriod(
  startTime: string,
  endTime: string,
  endPeriod: string,
): string {
  const startHour = Number(startTime.split(":")[0]);
  const endHour = Number(endTime.split(":")[0]);

  if (endPeriod === "AM" && startHour > endHour) {
    return "PM";
  }

  if (endPeriod === "PM" && startHour > endHour) {
    return "AM";
  }

  return endPeriod;
}

function parseSmithMadeDate(
  dayText: string,
  referenceDate: Dayjs,
  timeZone?: string,
): Dayjs | null {
  const day = Number(dayText);

  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return null;
  }

  const dateText = `${referenceDate.year()}-${referenceDate.month() + 1}-${day}`;
  const parsed = parseWithOptionalTimeZone(dateText, "YYYY-M-D", timeZone);

  return parsed.isValid() ? parsed : null;
}

function parseSmithMadeLocalDateTime(
  dayText: string,
  timeText: string,
  referenceDate: Dayjs,
  timeZone?: string,
): Dayjs | null {
  const day = Number(dayText);

  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return null;
  }

  const dateTimeText = `${referenceDate.year()}-${referenceDate.month() + 1}-${day} ${timeText}`;
  const parsed = parseWithOptionalTimeZone(
    dateTimeText,
    "YYYY-M-D h:mm A",
    timeZone,
  );

  return parsed.isValid() ? parsed : null;
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
