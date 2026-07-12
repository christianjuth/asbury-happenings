import * as cheerio from "cheerio";
import _ from "lodash";

import dayjs, { type Dayjs } from "../calendar.dates.js";
import type {
  CalendarEvent,
  CalendarSourceConfig,
  HtmlCalendarSourceConfig,
  SourcePage,
} from "../calendar.types.js";
import { normalizeText } from "../calendar.utils.js";

interface TimeOfDay {
  hour: number;
  minute: number;
}

interface TimeRange {
  start: TimeOfDay;
  end: TimeOfDay;
}

const ART629_TIME_ZONE = "America/New_York";
const ART629_ADDRESS = "art629 Gallery, 629 Cookman Ave, Asbury Park, NJ 07712";
const EXPANSION_DAYS = 90;
const DAY_NAME_TO_INDEX = new Map([
  ["sunday", 0],
  ["sundays", 0],
  ["monday", 1],
  ["mondays", 1],
  ["tuesday", 2],
  ["tuesdays", 2],
  ["wednesday", 3],
  ["wednesdays", 3],
  ["thursday", 4],
  ["thursdays", 4],
  ["friday", 5],
  ["fridays", 5],
  ["saturday", 6],
  ["saturdays", 6],
]);
const MONTH_NAME_TO_NUMBER = new Map([
  ["january", 1],
  ["february", 2],
  ["march", 3],
  ["april", 4],
  ["may", 5],
  ["june", 6],
  ["july", 7],
  ["august", 8],
  ["september", 9],
  ["october", 10],
  ["november", 11],
  ["december", 12],
]);

export const ART629_SOURCE = {
  id: "art629",
  name: "art629 Gallery",
  sourceType: "html",
  url: "https://www.art629.com/art-classes",
  containerSelector: "body",
  selectors: {
    title: ":self",
  },
  timeZone: ART629_TIME_ZONE,
  defaultAddress: ART629_ADDRESS,
  extractEvents: extractArt629Events,
} satisfies CalendarSourceConfig;

export function extractArt629Events(
  html: string,
  config: HtmlCalendarSourceConfig,
  sourcePage: SourcePage,
): CalendarEvent[] {
  const $ = cheerio.load(html);
  const lines = readArt629Lines($);
  const cancellationDates = readCancellationDates(lines, sourcePage);
  const events: CalendarEvent[] = [];
  let sectionTitle: string | undefined;
  let monthlyTimeRange: TimeRange | undefined;
  let monthlyTitle: string | undefined;

  for (const line of lines) {
    if (/^figure drawing$/i.test(line)) {
      sectionTitle = "Figure Drawing";
      continue;
    }

    if (/^painting classes$/i.test(line)) {
      sectionTitle = "Painting Classes";
      continue;
    }

    const weekly = parseWeeklyLine(line, sectionTitle);

    if (weekly) {
      events.push(
        ...expandWeeklyEvents(weekly, config, sourcePage, cancellationDates),
      );
      continue;
    }

    const monthlyTime = line.match(/^one\s+friday\s+per\s+month\s+(.+?):?$/i);

    if (monthlyTime?.[1]) {
      monthlyTimeRange = parseTimeRange(monthlyTime[1]) ?? undefined;
      monthlyTitle = undefined;
      continue;
    }

    if (monthlyTimeRange && /^next date:/i.test(line)) {
      const date = parseMonthDay(
        line.replace(/^next date:\s*/i, ""),
        sourcePage.referenceDate,
        config.timeZone,
      );

      if (date && monthlyTitle) {
        const timeZone = config.timeZone ?? ART629_TIME_ZONE;
        const start = buildDateTime(date, monthlyTimeRange.start, timeZone);

        events.push(
          buildEvent(
            monthlyTitle,
            start,
            start.add(getDurationMinutes(monthlyTimeRange), "minute"),
            line,
            config,
          ),
        );
      }
      continue;
    }

    if (monthlyTimeRange && line && !isIgnoredLine(line)) {
      monthlyTitle = line;
    }
  }

  return _.uniqBy(events, (event) =>
    [event.title, event.start.toISOString()].join("|"),
  );
}

function readArt629Lines($: cheerio.CheerioAPI): string[] {
  const paragraphLines = $(".wixui-rich-text p")
    .map((_, paragraph) => normalizeArt629Text($(paragraph).text()))
    .get()
    .filter(Boolean);

  if (paragraphLines.length) {
    return paragraphLines;
  }

  return normalizeArt629Text($("body").text())
    .split(/\s{2,}/)
    .filter(Boolean);
}

function normalizeArt629Text(value: string | undefined): string {
  return normalizeText(value?.replace(/[\u200B-\u200D\uFEFF]/g, ""));
}

function readCancellationDates(
  lines: string[],
  sourcePage: SourcePage,
): Set<string> {
  const dates = new Set<string>();

  for (const line of lines) {
    if (/^class(?:es)?\s+cancelled\b/i.test(line)) {
      for (const date of parseCancellationLine(
        line.replace(/^class(?:es)?\s+cancelled\s*/i, ""),
        sourcePage.referenceDate,
      )) {
        dates.add(date);
      }
      continue;
    }

    if (
      /^(?:sun|mon|tues?|wed|thurs?|fri|sat)(?:urday|day|nesday)?s?\s+/i.test(
        line,
      )
    ) {
      for (const date of parseCancellationLine(
        line,
        sourcePage.referenceDate,
      )) {
        dates.add(date);
      }
    }
  }

  return dates;
}

function parseCancellationLine(line: string, referenceDate: Dayjs): string[] {
  const values: string[] = [];
  let month: number | undefined;
  const parts = line
    .replace(
      /^(?:sun|mon|tues?|wed|thurs?|fri|sat)(?:urday|day|nesday)?s?\s+/i,
      "",
    )
    .split(/\s+and\s+|,/i)
    .map((part) => normalizeText(part));

  for (const part of parts) {
    const match = part.match(/^([a-z]+)?\s*(\d{1,2})$/i);

    if (!match) {
      continue;
    }

    const rawMonth = match[1]?.toLowerCase();
    const day = Number(match[2]);

    if (rawMonth) {
      month = MONTH_NAME_TO_NUMBER.get(rawMonth);
    }

    if (!month || day < 1 || day > 31) {
      continue;
    }

    const date = dayjs.tz(
      `${referenceDate.year()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      "YYYY-MM-DD",
      ART629_TIME_ZONE,
    );

    if (date.isValid()) {
      values.push(date.format("YYYY-MM-DD"));
    }
  }

  return values;
}

function parseWeeklyLine(
  line: string,
  sectionTitle: string | undefined,
):
  | {
      title: string;
      day: number;
      timeRange: TimeRange;
      scheduleText: string;
    }
  | undefined {
  const match = line.match(
    /^([a-z]+days?)\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?\s*-\s*[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm))(?::\s*(.+))?$/i,
  );

  if (!match) {
    return undefined;
  }

  const day = match[1] ? DAY_NAME_TO_INDEX.get(match[1].toLowerCase()) : null;
  const timeRange = match[2] ? parseTimeRange(match[2]) : null;
  const title = normalizeText(match[3]) || sectionTitle;

  if (day === null || day === undefined || !timeRange || !title) {
    return undefined;
  }

  return {
    title,
    day,
    timeRange,
    scheduleText: line,
  };
}

function parseTimeRange(value: string): TimeRange | null {
  const match = normalizeText(value).match(
    /^([0-9]{1,2}(?::[0-9]{2})?)\s*(am|pm)?\s*-\s*([0-9]{1,2}(?::[0-9]{2})?)\s*(am|pm)$/i,
  );

  if (!match) {
    return null;
  }

  const startMeridiem = match[2] ?? match[4];
  const endMeridiem = match[4];
  const start = match[1] ? parseClockTime(match[1], startMeridiem) : null;
  const end = match[3] ? parseClockTime(match[3], endMeridiem) : null;

  return start && end ? { start, end } : null;
}

function parseClockTime(
  value: string,
  meridiem: string | undefined,
): TimeOfDay | null {
  const match = value.match(/^([0-9]{1,2})(?::([0-9]{2}))?$/);
  const hour12 = Number(match?.[1]);
  const minute = Number(match?.[2] ?? 0);
  const normalizedMeridiem = meridiem?.toLowerCase();

  if (
    !match ||
    hour12 < 1 ||
    hour12 > 12 ||
    minute < 0 ||
    minute > 59 ||
    !normalizedMeridiem
  ) {
    return null;
  }

  return {
    hour: normalizedMeridiem === "pm" ? (hour12 % 12) + 12 : hour12 % 12,
    minute,
  };
}

function expandWeeklyEvents(
  weekly: {
    title: string;
    day: number;
    timeRange: TimeRange;
    scheduleText: string;
  },
  config: HtmlCalendarSourceConfig,
  sourcePage: SourcePage,
  cancellationDates: Set<string>,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const timeZone = config.timeZone ?? ART629_TIME_ZONE;
  const rangeStart = sourcePage.referenceDate.tz(timeZone).startOf("day");
  const rangeEnd = rangeStart.add(EXPANSION_DAYS, "day");

  for (
    let date = rangeStart;
    date.isBefore(rangeEnd);
    date = date.add(1, "day")
  ) {
    if (
      date.day() !== weekly.day ||
      cancellationDates.has(date.format("YYYY-MM-DD"))
    ) {
      continue;
    }

    const start = buildDateTime(date, weekly.timeRange.start, timeZone);
    const end = buildDateTime(date, weekly.timeRange.end, timeZone);

    events.push(
      buildEvent(
        weekly.title,
        start,
        end.isAfter(start) ? end : end.add(1, "day"),
        weekly.scheduleText,
        config,
      ),
    );
  }

  return events;
}

function parseMonthDay(
  value: string,
  referenceDate: Dayjs,
  timeZone?: string,
): Dayjs | null {
  const match = normalizeText(value).match(/^([a-z]+)\s+(\d{1,2})$/i);

  if (!match?.[1] || !match[2]) {
    return null;
  }

  const month = MONTH_NAME_TO_NUMBER.get(match[1].toLowerCase());
  const day = Number(match[2]);

  if (!month || day < 1 || day > 31) {
    return null;
  }

  const parsed = dayjs.tz(
    `${referenceDate.year()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} 00:00`,
    "YYYY-MM-DD HH:mm",
    timeZone ?? ART629_TIME_ZONE,
  );

  return parsed.isValid() ? parsed : null;
}

function buildDateTime(date: Dayjs, time: TimeOfDay, timeZone: string): Dayjs {
  return dayjs.tz(
    `${date.format("YYYY-MM-DD")} ${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`,
    "YYYY-MM-DD HH:mm",
    timeZone,
  );
}

function buildEvent(
  title: string,
  start: Dayjs,
  end: Dayjs,
  scheduleText: string,
  config: HtmlCalendarSourceConfig,
): CalendarEvent {
  return {
    title,
    start,
    end,
    description: scheduleText,
    location: config.defaultAddress,
    address: config.defaultAddress,
    url: config.url,
  };
}

function getDurationMinutes(timeRange: TimeRange): number {
  const start = timeRange.start.hour * 60 + timeRange.start.minute;
  const end = timeRange.end.hour * 60 + timeRange.end.minute;

  return end > start ? end - start : end + 24 * 60 - start;
}

function isIgnoredLine(line: string): boolean {
  return (
    /^weekly art classes/i.test(line) ||
    /^instructed by/i.test(line) ||
    /^class(?:es)? cancelled$/i.test(line) ||
    /^oil or acrylic$/i.test(line) ||
    /^private/i.test(line)
  );
}
