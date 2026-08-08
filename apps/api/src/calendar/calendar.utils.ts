import _ from "lodash";

import { cityStateFromLocation } from "./address.utils.js";
import type { CalendarEvent, SelectorSpec } from "./calendar.types.js";
import dayjs, { type Dayjs } from "./calendar.dates.js";
import { timeZoneForState } from "./state-time-zones.js";

const DEFAULT_DATE_FORMATS = [
  "ddd, M/D/YYYY",
  "ddd, MM/DD/YYYY",
  "MMM DD",
  "MMM D",
  "MMMM DD",
  "MMMM D",
  "MMM DD YYYY",
  "MMM D YYYY",
  "MMMM DD YYYY",
  "MMMM D YYYY",
  "M/D/YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD",
];

const DEFAULT_TIME_FORMATS = [
  "h:mma",
  "h:mm a",
  "h:mmA",
  "h:mm A",
  "ha",
  "h a",
  "hA",
  "h A",
  "H:mm",
  "HH:mm",
];

export function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function eventTimeZone(
  event: CalendarEvent,
  fallbackTimeZone: string,
): string {
  if (event.startTimeZone) {
    return event.startTimeZone;
  }

  const state = cityStateFromLocation(event.location ?? event.address)
    ?.split(",")[1]
    ?.trim();

  return timeZoneForState(state)?.timeZone ?? fallbackTimeZone;
}

export function eventEndInTimeZone(
  event: CalendarEvent,
  fallbackTimeZone: string,
): Dayjs {
  if (!event.allDay) {
    return event.end;
  }

  return dayjs.tz(eventEndDate(event), eventTimeZone(event, fallbackTimeZone));
}

export function eventEndDate(event: CalendarEvent): string {
  const endDate = event.end.utc().format("YYYY-MM-DD");

  if (!event.allDay || endDate !== event.start.utc().format("YYYY-MM-DD")) {
    return endDate;
  }

  // Keep the legacy ICS event untouched, but expose the one-day interpretation
  // to the Samantha JSON and its internal lifecycle consumers.
  return event.start.utc().add(1, "day").format("YYYY-MM-DD");
}

// Mirrors `isEventCanceled` on samanthadress.com: an event counts as cancelled
// when iCalendar STATUS says so, or when the summary says so in either
// spelling. Organizers do both, and the site renders a cancellation based on
// this combined rule, so anything deriving page state must use the same one.
export function isEventCancelled(event: CalendarEvent): boolean {
  if (event.status === "cancelled") {
    return true;
  }

  const summary = event.title.toLowerCase();

  return summary.includes("canceled") || summary.includes("cancelled");
}

export function resolveOptionalUrl(
  value: string | undefined,
  sourceUrl: string,
): string | undefined {
  if (!value) {
    return undefined;
  }

  return new URL(value, sourceUrl).toString();
}

export function parseDateOrNull(
  value: string,
  selector: SelectorSpec | undefined,
  fallbackFormats: string[] | undefined,
  referenceDate: Dayjs,
  timeZone?: string,
): Dayjs | null {
  for (const format of getDateFormats(selector, fallbackFormats)) {
    const parsed = parseFormattedDate(value, format, referenceDate, timeZone);

    if (parsed) {
      return parsed;
    }
  }

  const parsed = dayjs(value);

  return parsed.isValid() ? parsed : null;
}

export function parseDateAndTimeOrNull(
  dateValue: string,
  dateSelector: SelectorSpec,
  timeValue: string,
  timeSelector: SelectorSpec | undefined,
  fallbackDateFormats: string[] | undefined,
  fallbackTimeFormats: string[] | undefined,
  referenceDate: Dayjs,
  timeZone?: string,
): Dayjs | null {
  for (const dateFormat of getDateFormats(dateSelector, fallbackDateFormats)) {
    for (const timeFormat of getTimeFormats(
      timeSelector,
      fallbackTimeFormats,
    )) {
      const parsed = parseFormattedDateTime(
        dateValue,
        dateFormat,
        timeValue,
        timeFormat,
        referenceDate,
        timeZone,
      );

      if (parsed) {
        return parsed;
      }
    }
  }

  const fallbackValue = /\b\d{4}\b/.test(dateValue)
    ? `${dateValue} ${timeValue}`
    : `${dateValue} ${referenceDate.year()} ${timeValue}`;
  const parsed = dayjs(fallbackValue);

  if (!parsed.isValid()) {
    return null;
  }

  if (!timeZone) {
    return parsed;
  }

  try {
    return dayjs.tz(
      parsed.format("YYYY-MM-DD HH:mm:ss"),
      "YYYY-MM-DD HH:mm:ss",
      timeZone,
    );
  } catch {
    return parsed;
  }
}

export function parseWithOptionalTimeZone(
  value: string,
  format: string,
  timeZone: string | undefined,
): Dayjs {
  if (!timeZone) {
    return dayjs.utc(value, format, true);
  }

  const parsed = dayjs(value, format, true);

  if (!parsed.isValid()) {
    return parsed;
  }

  try {
    return dayjs.tz(
      parsed.format("YYYY-MM-DD HH:mm:ss"),
      "YYYY-MM-DD HH:mm:ss",
      timeZone,
    );
  } catch {
    return parsed;
  }
}

function getDateFormats(
  selector: SelectorSpec | undefined,
  fallbackFormats: string[] | undefined,
): string[] {
  const selectorFormats =
    typeof selector === "object" && selector.format
      ? _.castArray(selector.format)
      : [];

  return _.uniq([
    ...selectorFormats,
    ...(fallbackFormats ?? []),
    ...DEFAULT_DATE_FORMATS,
  ]);
}

function getTimeFormats(
  selector: SelectorSpec | undefined,
  fallbackFormats: string[] | undefined,
): string[] {
  const selectorFormats =
    typeof selector === "object" && selector.format
      ? _.castArray(selector.format)
      : [];

  return _.uniq([
    ...selectorFormats,
    ...(fallbackFormats ?? []),
    ...DEFAULT_TIME_FORMATS,
  ]);
}

function parseFormattedDate(
  value: string,
  format: string,
  referenceDate: Dayjs,
  timeZone?: string,
): Dayjs | null {
  const parseValue = formatHasYear(format)
    ? value
    : `${value} ${referenceDate.year()}`;
  const parseFormat = formatHasYear(format) ? format : `${format} YYYY`;
  const parsed = parseWithOptionalTimeZone(parseValue, parseFormat, timeZone);

  return parsed.isValid() ? parsed : null;
}

function parseFormattedDateTime(
  dateValue: string,
  dateFormat: string,
  timeValue: string,
  timeFormat: string,
  referenceDate: Dayjs,
  timeZone?: string,
): Dayjs | null {
  const value = formatHasYear(dateFormat)
    ? `${dateValue} ${timeValue}`
    : `${dateValue} ${referenceDate.year()} ${timeValue}`;
  const format = formatHasYear(dateFormat)
    ? `${dateFormat} ${timeFormat}`
    : `${dateFormat} YYYY ${timeFormat}`;
  const parsed = parseWithOptionalTimeZone(value, format, timeZone);

  return parsed.isValid() ? parsed : null;
}

function formatHasYear(format: string): boolean {
  return /Y/.test(format);
}
