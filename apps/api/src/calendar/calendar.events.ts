import { createHash } from "node:crypto";
import { getCachedCalendarEvents } from "./calendar.cache.js";
import { CALENDAR_SOURCES } from "./calendar.config.js";
import dayjs from "./calendar.dates.js";
import type {
  CalendarEvent,
  CalendarEventStatus,
  CalendarSourceConfig,
} from "./calendar.types.js";

const DEFAULT_TIME_ZONE = "America/New_York";

interface CalendarEventsResource {
  id: string;
  name: string;
  timeZone: string;
  loading: boolean;
  ready: boolean;
  subscriptionPath: string;
}

interface CalendarEventData {
  id: string;
  resourceId: string;
  uid?: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
  address?: string;
  url?: string;
  status?: CalendarEventStatus;
}

interface CalendarEventsResponse {
  date: string;
  generatedAt: string;
  resources: CalendarEventsResource[];
  events: CalendarEventData[];
}

export function getCalendarEventsResponse(
  date: string,
  now = dayjs(),
): CalendarEventsResponse {
  const resources: CalendarEventsResource[] = [];
  const events: CalendarEventData[] = [];

  for (const config of CALENDAR_SOURCES) {
    const cached = getCachedCalendarEvents(config, now);
    const timeZone = config.timeZone ?? DEFAULT_TIME_ZONE;

    resources.push({
      id: config.id,
      name: config.name,
      timeZone,
      loading: cached.loading,
      ready: cached.ready,
      subscriptionPath: `/calendar/${config.id}.ics`,
    });

    events.push(
      ...cached.events
        .filter((event) => isEventOnDate(event, timeZone, date))
        .map((event) => serializeCalendarEvent(config, event)),
    );
  }

  events.sort(
    (left, right) =>
      left.start.localeCompare(right.start) ||
      left.end.localeCompare(right.end) ||
      left.title.localeCompare(right.title),
  );

  return {
    date,
    generatedAt: now.toISOString(),
    resources,
    events,
  };
}

export function isCalendarDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    dayjs(value, "YYYY-MM-DD", true).isValid()
  );
}

function isEventOnDate(
  event: CalendarEvent,
  timeZone: string,
  date: string,
): boolean {
  if (event.allDay) {
    const range = getAllDayRange(event);

    return range.start <= date && range.end > date;
  }

  const dayStart = dayjs.tz(`${date} 00:00:00`, timeZone);
  const nextDate = dayjs.utc(date).add(1, "day").format("YYYY-MM-DD");
  const dayEnd = dayjs.tz(`${nextDate} 00:00:00`, timeZone);

  return event.end.isAfter(dayStart) && event.start.isBefore(dayEnd);
}

function serializeCalendarEvent(
  config: CalendarSourceConfig,
  event: CalendarEvent,
): CalendarEventData {
  const range = event.allDay
    ? getAllDayRange(event)
    : {
        start: event.start.toISOString(),
        end: event.end.toISOString(),
      };

  return {
    id: createEventId(config.id, event),
    resourceId: config.id,
    uid: event.uid,
    title: event.title,
    start: range.start,
    end: range.end,
    allDay: Boolean(event.allDay),
    description: event.description,
    location: event.location,
    address: event.address,
    url: event.url,
    status: event.status,
  };
}

function getAllDayRange(event: CalendarEvent): {
  start: string;
  end: string;
} {
  const start = event.start.format("YYYY-MM-DD");
  const parsedEnd = event.end.format("YYYY-MM-DD");
  const end =
    parsedEnd > start
      ? parsedEnd
      : event.start.add(1, "day").format("YYYY-MM-DD");

  return { start, end };
}

function createEventId(resourceId: string, event: CalendarEvent): string {
  const fingerprint = [
    event.uid ?? "",
    event.title,
    event.start.toISOString(),
    event.url ?? "",
  ].join("|");
  const hash = createHash("sha256")
    .update(fingerprint)
    .digest("hex")
    .slice(0, 16);

  return `${resourceId}:${hash}`;
}
