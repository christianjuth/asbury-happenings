import type { CalendarEvent, CalendarSourceConfig } from "../calendar.types.js";

const EVENT_URL_BASE = "https://samanthadress.com/event";
const EVENT_URL_TIME_ZONE = "America/New_York";

export const SAMANTHA_DRESS_SOURCE = {
  id: "samantha-dress",
  name: "Samantha Dress",
  sourceType: "ics",
  url: "https://calendar.google.com/calendar/ical/65138dbc87c80e90f51e1ad6850a279be725a04b3a71786550afa5e1c38d63fe%40group.calendar.google.com/public/basic.ics",
  browserAllowedOrigins: ["https://samanthadress.com"],
  timeZone: "America/New_York",
  defaultDurationMinutes: 60,
  transformEvent: addSamanthaDressEventUrl,
} satisfies CalendarSourceConfig;

function addSamanthaDressEventUrl(event: CalendarEvent): CalendarEvent {
  if (event.url || !event.uid) {
    return event;
  }

  return {
    ...event,
    url: buildSamanthaDressEventUrl(event),
  };
}

function buildSamanthaDressEventUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    uid: event.uid ?? "",
    date: formatSamanthaDressEventDate(event),
    title: event.title,
  });

  return `${EVENT_URL_BASE}?${params.toString()}`;
}

function formatSamanthaDressEventDate(event: CalendarEvent): string {
  if (event.allDay) {
    return event.start.utc().format("YYYY-MM-DD");
  }

  return event.start.tz(EVENT_URL_TIME_ZONE).format("YYYY-MM-DD");
}
