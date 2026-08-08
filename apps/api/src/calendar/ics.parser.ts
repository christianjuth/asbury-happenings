import _ from "lodash";

import dayjs, { type Dayjs } from "./calendar.dates.js";
import type {
  CalendarEvent,
  CalendarEventStatus,
  CalendarTimeSource,
  IcsCalendarSourceConfig,
} from "./calendar.types.js";
import { normalizeText, parseWithOptionalTimeZone } from "./calendar.utils.js";

export function extractEventsFromIcs(
  icsText: string,
  config: IcsCalendarSourceConfig,
): CalendarEvent[] {
  return _.compact(
    readIcsEventComponents(icsText).map((component) => {
      const title = readIcsText(component, "SUMMARY");
      const start = readIcsDate(component, "DTSTART", config);

      if (!title || !start) {
        return null;
      }

      const end = readIcsDate(component, "DTEND", config) ?? {
        date: start.date.add(config.defaultDurationMinutes ?? 60, "minute"),
        allDay: start.allDay,
        // Inherits DTSTART's zone: a synthesized end is the same wall clock as
        // the start it was derived from, so leaving this unset would let the two
        // ends of one event be labelled in different zones.
        timeZone: start.timeZone,
        timeSource: start.timeSource,
      };
      const location =
        readIcsText(component, "LOCATION") ?? config.defaultAddress;

      return {
        uid: readIcsText(component, "UID"),
        title,
        start: start.date,
        end: end.date,
        allDay: start.allDay,
        description: readIcsText(component, "DESCRIPTION"),
        location,
        address: location,
        url: readIcsText(component, "URL"),
        status: readIcsStatus(component),
        startTimeZone: start.timeZone,
        endTimeZone: end.timeZone,
        startTimeSource: start.timeSource,
        endTimeSource: end.timeSource,
      };
    }),
  );
}

interface IcsContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface IcsDateValue {
  date: Dayjs;
  allDay: boolean;
  // The explicit TZID from the content line, when the source carried a valid
  // one. Absent for UTC (`Z`-suffixed), all-day and floating values, where the
  // feed never says which local zone to display the time in.
  timeZone?: string;
  // Which of those four forms the content line used. Kept because a floating
  // value is indistinguishable from a UTC one once parsed, and only the floating
  // one has a guessed zone baked into its instant.
  timeSource?: CalendarTimeSource;
}

function readIcsEventComponents(icsText: string): IcsContentLine[][] {
  const components: IcsContentLine[][] = [];
  let currentComponent: IcsContentLine[] | undefined;

  for (const line of unfoldIcsLines(icsText)) {
    const contentLine = parseIcsContentLine(line);

    if (!contentLine) {
      continue;
    }

    if (
      contentLine.name === "BEGIN" &&
      contentLine.value.toUpperCase() === "VEVENT"
    ) {
      currentComponent = [];
      continue;
    }

    if (
      contentLine.name === "END" &&
      contentLine.value.toUpperCase() === "VEVENT"
    ) {
      if (currentComponent) {
        components.push(currentComponent);
      }

      currentComponent = undefined;
      continue;
    }

    currentComponent?.push(contentLine);
  }

  return components;
}

function unfoldIcsLines(icsText: string): string[] {
  const lines: string[] = [];

  for (const line of icsText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")) {
    if (/^[ \t]/.test(line) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
      continue;
    }

    lines.push(line);
  }

  return lines;
}

function parseIcsContentLine(line: string): IcsContentLine | null {
  const separatorIndex = line.indexOf(":");

  if (separatorIndex <= 0) {
    return null;
  }

  const head = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1);
  const [rawName, ...rawParams] = head.split(";");
  const name = rawName?.toUpperCase();

  if (!name) {
    return null;
  }

  return {
    name,
    params: Object.fromEntries(
      rawParams
        .map((param) => {
          const [rawKey, ...rawValueParts] = param.split("=");

          return rawKey
            ? [
                rawKey.toUpperCase(),
                rawValueParts.join("=").replace(/^"|"$/g, ""),
              ]
            : undefined;
        })
        .filter((entry): entry is [string, string] => Boolean(entry)),
    ),
    value,
  };
}

function readIcsText(
  component: IcsContentLine[],
  name: string,
): string | undefined {
  const value = component.find((line) => line.name === name)?.value;

  return value ? normalizeText(unescapeIcsText(value)) || undefined : undefined;
}

// Cancelled events stay in the feed, so keep STATUS on the event instead of
// dropping it. Downstream consumers use it to tell a cancellation apart from
// an unchanged event.
function readIcsStatus(
  component: IcsContentLine[],
): CalendarEventStatus | undefined {
  const value = readIcsText(component, "STATUS")?.toLowerCase();

  if (value === "confirmed" || value === "tentative" || value === "cancelled") {
    return value;
  }

  return undefined;
}

function readIcsDate(
  component: IcsContentLine[],
  name: string,
  config: IcsCalendarSourceConfig,
): IcsDateValue | null {
  const line = component.find((contentLine) => contentLine.name === name);

  if (!line) {
    return null;
  }

  return parseIcsDateOrNull(line.value, line.params, config.timeZone);
}

function parseIcsDateOrNull(
  value: string,
  params: Record<string, string>,
  fallbackTimeZone?: string,
): IcsDateValue | null {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return null;
  }

  if (params["VALUE"] === "DATE" || /^\d{8}$/.test(normalizedValue)) {
    const parsed = dayjs.utc(normalizedValue, "YYYYMMDD", true);

    return parsed.isValid()
      ? { date: parsed, allDay: true, timeSource: "date" }
      : null;
  }

  if (/^\d{8}T\d{6}Z$/.test(normalizedValue)) {
    const parsed = dayjs.utc(normalizedValue, "YYYYMMDDTHHmmss[Z]", true);

    return parsed.isValid()
      ? { date: parsed, allDay: false, timeSource: "utc" }
      : null;
  }

  if (/^\d{8}T\d{6}$/.test(normalizedValue)) {
    const explicitTimeZone = readIcsTimeZone(params["TZID"]);
    const parsed = parseWithOptionalTimeZone(
      normalizedValue,
      "YYYYMMDDTHHmmss",
      explicitTimeZone ?? fallbackTimeZone,
    );

    return parsed.isValid()
      ? {
          date: parsed,
          allDay: false,
          timeZone: explicitTimeZone,
          // No TZID: the instant above only exists because the source's
          // configured zone stood in for the one the feed never gave.
          timeSource: explicitTimeZone ? "tzid" : "floating",
        }
      : null;
  }

  const parsed = dayjs(normalizedValue);

  return parsed.isValid() ? { date: parsed, allDay: false } : null;
}

function readIcsTimeZone(tzid: string | undefined): string | undefined {
  return tzid && isValidTimeZone(tzid) ? tzid : undefined;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });

    return true;
  } catch {
    return false;
  }
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\[nN]/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}
