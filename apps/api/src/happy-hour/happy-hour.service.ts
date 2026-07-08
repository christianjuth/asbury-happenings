import * as cheerio from "cheerio";
import ical, { ICalEventRepeatingFreq, ICalWeekday } from "ical-generator";
import lodash from "lodash";

import dayjs, { type Dayjs } from "../calendar/calendar.dates.js";
import {
  type CalendarEvent,
  type FetchStatus,
} from "../calendar/calendar.service.js";
import {
  normalizeText,
  resolveOptionalUrl,
} from "../calendar/calendar.utils.js";
import {
  HAPPY_HOUR_SOURCE,
  type HappyHourSourceConfig,
} from "./happy-hour.config.js";

export interface HappyHourEvent extends CalendarEvent {
  scheduleText: string;
  day: number;
  byDay: ICalWeekday;
  verifiedDate?: string;
}

interface RestaurantDetails {
  name: string;
  websiteUrl?: string;
  phone?: string;
  verifiedDate?: string;
  mapUrl?: string;
  instagramUrl?: string;
  menuUrl?: string;
  specials: string[];
}

interface ScheduleSlot {
  text: string;
  days: number[];
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [
  ICalWeekday.SU,
  ICalWeekday.MO,
  ICalWeekday.TU,
  ICalWeekday.WE,
  ICalWeekday.TH,
  ICalWeekday.FR,
  ICalWeekday.SA,
];
const DAY_NAME_TO_INDEX = new Map(
  DAY_NAMES.map((dayName, index) => [dayName.toLowerCase(), index]),
);

class HappyHourFetchError extends Error {
  constructor(
    readonly sourceUrl: string,
    readonly status: number,
    readonly text: string,
  ) {
    super(`Failed to fetch ${sourceUrl}: ${status}`);
    this.name = "HappyHourFetchError";
  }
}

export async function fetchHappyHourEvents(
  config: HappyHourSourceConfig = HAPPY_HOUR_SOURCE,
  now = dayjs(),
): Promise<{
  sourceUrl: string;
  events: HappyHourEvent[];
  fetchStatus: FetchStatus;
}> {
  const { text, fetchStatus } = await fetchHappyHourSourceText(config);

  return {
    sourceUrl: config.url,
    events: extractHappyHourEvents(text, config, now),
    fetchStatus,
  };
}

export function extractHappyHourEvents(
  html: string,
  config: HappyHourSourceConfig = HAPPY_HOUR_SOURCE,
  now = dayjs(),
): HappyHourEvent[] {
  const $ = cheerio.load(html);
  const events: HappyHourEvent[] = [];
  const referenceWeekStart = now
    .tz(config.timeZone)
    .startOf("week")
    .startOf("day");

  $("#restaurant-happy-hours article.restaurant.hh").each((_, element) => {
    const article = $(element);
    const restaurant = readRestaurantDetails($, article, config.url);

    if (!restaurant.name) {
      return;
    }

    const description = buildEventDescription(restaurant);

    article.find("time.dayhour").each((__, timeElement) => {
      const scheduleText = normalizeText($(timeElement).text());
      const slot = parseScheduleSlot(scheduleText);

      if (!slot) {
        return;
      }

      for (const day of slot.days) {
        const start = buildSlotDate(
          referenceWeekStart,
          day,
          slot.startHour,
          slot.startMinute,
          config.timeZone,
        );
        const end = buildSlotDate(
          referenceWeekStart,
          day,
          slot.endHour,
          slot.endMinute,
          config.timeZone,
        );
        const adjustedEnd = end.isAfter(start) ? end : end.add(1, "day");

        events.push({
          title: restaurant.name,
          start,
          end: adjustedEnd,
          description,
          location: restaurant.name,
          url:
            restaurant.websiteUrl ??
            restaurant.menuUrl ??
            restaurant.instagramUrl,
          scheduleText: slot.text,
          day,
          byDay: WEEKDAYS[day] ?? ICalWeekday.SU,
          verifiedDate: restaurant.verifiedDate,
        });
      }
    });
  });

  return lodash.uniqBy(events, (event) =>
    [event.title, event.day, event.scheduleText].join("|"),
  );
}

export function happyHourEventsToIcs(
  calendarName: string,
  events: CalendarEvent[],
): string {
  const calendar = ical({
    name: calendarName,
    prodId: {
      company: "calendar-service",
      product: "happy-hour-calendar",
    },
    timezone: HAPPY_HOUR_SOURCE.timeZone,
  });

  for (const event of events) {
    const happyHourEvent = event as HappyHourEvent;

    calendar.createEvent({
      summary: event.title,
      start: event.start,
      end: event.end,
      description: event.description,
      location: event.location,
      url: event.url,
      timezone: HAPPY_HOUR_SOURCE.timeZone,
      repeating: {
        freq: ICalEventRepeatingFreq.WEEKLY,
        byDay: happyHourEvent.byDay,
      },
    });
  }

  return calendar.toString();
}

export function happyHourEventsToDebugText(
  calendarName: string,
  sourceUrl: string,
  events: CalendarEvent[],
  fetchStatus?: FetchStatus,
): string {
  const lines = [
    `Calendar: ${calendarName}`,
    `Source: ${sourceUrl}`,
    `Fetch: upstream ${fetchStatus ?? "unknown"}`,
    `Events: ${events.length}`,
    "",
  ];

  for (const [index, event] of events.entries()) {
    const happyHourEvent = event as HappyHourEvent;

    lines.push(
      `#${index + 1} ${event.title}`,
      `Schedule: ${happyHourEvent.scheduleText ?? ""}`,
      `Start: ${event.start.toISOString()}`,
      `End: ${event.end.toISOString()}`,
    );

    if (event.url) {
      lines.push(`URL: ${event.url}`);
    }

    if (event.description) {
      lines.push(`Description: ${event.description}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

async function fetchHappyHourSourceText(
  config: HappyHourSourceConfig,
): Promise<{ text: string; fetchStatus: FetchStatus }> {
  const response = await fetch(config.url);
  const text = await response.text();

  if (!response.ok) {
    throw new HappyHourFetchError(config.url, response.status, text);
  }

  return { text, fetchStatus: "fetched" };
}

function readRestaurantDetails(
  $: cheerio.CheerioAPI,
  article: ReturnType<cheerio.CheerioAPI>,
  sourceUrl: string,
): RestaurantDetails {
  const headerLinks = article.find(":scope > header a");
  const websiteLink = headerLinks
    .filter(
      (_, link) => !normalizeText($(link).attr("href")).startsWith("tel:"),
    )
    .first();
  const phoneLink = headerLinks
    .filter((_, link) => normalizeText($(link).attr("href")).startsWith("tel:"))
    .first();
  const linkByTitle = (title: string) => {
    const link = article
      .find(":scope > footer a")
      .filter(
        (_, footerLink) =>
          normalizeText(
            $(footerLink).find("img").attr("title"),
          ).toLowerCase() === title,
      )
      .first();

    return resolveOptionalUrl(
      normalizeText(link.attr("href")) || undefined,
      sourceUrl,
    );
  };

  return {
    name: normalizeText(websiteLink.text()),
    websiteUrl: resolveOptionalUrl(
      normalizeText(websiteLink.attr("href")) || undefined,
      sourceUrl,
    ),
    phone: normalizeText(phoneLink.text()) || undefined,
    verifiedDate:
      normalizeText(article.find(".verified time").first().text()) || undefined,
    mapUrl: linkByTitle("map"),
    instagramUrl: linkByTitle("instagram"),
    menuUrl: linkByTitle("happy hour menu"),
    specials: article
      .find(":scope > content li")
      .map((_, item) => normalizeText($(item).text()))
      .get()
      .filter(Boolean),
  };
}

function buildEventDescription(
  restaurant: RestaurantDetails,
): string | undefined {
  return (
    lodash
      .compact([
        restaurant.specials.join("\n"),
        restaurant.phone ? `Phone: ${restaurant.phone}` : undefined,
        restaurant.verifiedDate
          ? `Verified: ${restaurant.verifiedDate}`
          : undefined,
        restaurant.menuUrl ? `Menu: ${restaurant.menuUrl}` : undefined,
        restaurant.instagramUrl
          ? `Instagram: ${restaurant.instagramUrl}`
          : undefined,
        restaurant.mapUrl ? `Map: ${restaurant.mapUrl}` : undefined,
      ])
      .join("\n") || undefined
  );
}

function parseScheduleSlot(value: string): ScheduleSlot | null {
  const match = value.match(
    /^([A-Za-z]{3}(?:\s*-\s*[A-Za-z]{3})?(?:\s*,\s*[A-Za-z]{3}(?:\s*-\s*[A-Za-z]{3})?)*)\s+([0-9]{1,2}(?::[0-9]{2})?\s*[ap]m)\s*-\s*([0-9]{1,2}(?::[0-9]{2})?\s*[ap]m)$/i,
  );

  if (!match) {
    return null;
  }

  const [, rawDays, rawStart, rawEnd] = match;
  const startTime = rawStart ? parseClockTime(rawStart) : null;
  const endTime = rawEnd ? parseClockTime(rawEnd) : null;
  const days = rawDays ? parseDays(rawDays) : [];

  if (!startTime || !endTime || !days.length) {
    return null;
  }

  return {
    text: value,
    days,
    startHour: startTime.hour,
    startMinute: startTime.minute,
    endHour: endTime.hour,
    endMinute: endTime.minute,
  };
}

function parseDays(value: string): number[] {
  return lodash.uniq(
    lodash
      .flatMap(value.split(","), (part) => {
        const [rawStart, rawEnd] = part
          .split("-")
          .map((day) => normalizeText(day).toLowerCase());
        const start = rawStart ? DAY_NAME_TO_INDEX.get(rawStart) : undefined;
        const end = rawEnd ? DAY_NAME_TO_INDEX.get(rawEnd) : undefined;

        if (start === undefined) {
          return [];
        }

        if (end === undefined) {
          return [start];
        }

        const dayCount = end >= start ? end - start + 1 : 7 - start + end + 1;

        return lodash.range(dayCount).map((offset) => (start + offset) % 7);
      })
      .sort((left, right) => left - right),
  );
}

function parseClockTime(
  value: string,
): { hour: number; minute: number } | null {
  const match = normalizeText(value).match(
    /^([0-9]{1,2})(?::([0-9]{2}))?\s*([ap])m$/i,
  );

  if (!match) {
    return null;
  }

  const hour12 = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();

  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59 || !meridiem) {
    return null;
  }

  const hour = meridiem === "p" ? (hour12 % 12) + 12 : hour12 % 12;

  return { hour, minute };
}

function buildSlotDate(
  referenceWeekStart: Dayjs,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Dayjs {
  const date = referenceWeekStart.add(day, "day");

  return dayjs.tz(
    `${date.format("YYYY-MM-DD")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    "YYYY-MM-DD HH:mm",
    timeZone,
  );
}
