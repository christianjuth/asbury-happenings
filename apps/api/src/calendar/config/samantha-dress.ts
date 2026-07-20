import { parseAddress } from "addresser";

import type { CalendarEvent, CalendarSourceConfig } from "../calendar.types.js";

const EVENT_URL_BASE = "https://samanthadress.com/events";
const EVENT_URL_TIME_ZONE = "America/New_York";
const DEFAULT_EVENT_STATE = "nj";
const DEFAULT_EVENT_CITY_SLUG = "long-beach-island";

export const SAMANTHA_DRESS_SOURCE = {
  id: "samantha-dress",
  name: "Samantha Dress",
  sourceType: "ics",
  url: "https://calendar.google.com/calendar/ical/65138dbc87c80e90f51e1ad6850a279be725a04b3a71786550afa5e1c38d63fe%40group.calendar.google.com/public/basic.ics",
  browserAllowedOrigins: [
    "https://samanthadress.com",
    "http://localhost:3000",
    // Covers every Cloudflare Pages branch build, e.g.
    // https://318b4aca.sams-portfolio-6ir.pages.dev
    "https://*.sams-portfolio-6ir.pages.dev",
  ],
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
  const { state, citySlug } = resolveEventCityAndState(
    event.address ?? event.location,
  );
  const date = formatSamanthaDressEventDate(event);
  const uid = encodeURIComponent(event.uid ?? "");

  return `${EVENT_URL_BASE}/${state}/${citySlug}/${date}/${uid}`;
}

function resolveEventCityAndState(address: string | undefined): {
  state: string;
  citySlug: string;
} {
  if (address) {
    try {
      const parsed = parseAddress(address);

      if (parsed.stateAbbreviation && parsed.placeName) {
        return {
          state: parsed.stateAbbreviation.toLowerCase(),
          citySlug: slugifyCity(parsed.placeName),
        };
      }
    } catch {
      // Fall through to defaults; samanthadress.com repairs mismatched
      // city/state values as long as the event UID resolves.
    }
  }

  return { state: DEFAULT_EVENT_STATE, citySlug: DEFAULT_EVENT_CITY_SLUG };
}

function slugifyCity(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatSamanthaDressEventDate(event: CalendarEvent): string {
  if (event.allDay) {
    return event.start.utc().format("YYYY-MM-DD");
  }

  return event.start.tz(EVENT_URL_TIME_ZONE).format("YYYY-MM-DD");
}
