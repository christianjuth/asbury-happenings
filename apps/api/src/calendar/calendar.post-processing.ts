import * as cheerio from "cheerio";
import _ from "lodash";

import { normalizeText, parseWithOptionalTimeZone } from "./calendar.utils.js";
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

function stripHtml(value: string): string {
  const $ = cheerio.load(value);

  $("style, script, noscript").remove();
  $("br").replaceWith(" ");
  $("p, div, li, h1, h2, h3, h4, h5, h6").append(" ");

  return normalizeText($.root().text());
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
