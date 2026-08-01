import type { CalendarEvent, CalendarSourceConfig } from "../calendar.types.js";
import { eventCityLocation } from "../address.utils.js";

export const SAMANTHA_DRESS_HOST = "samanthadress.com";
export const SAMANTHA_DRESS_EVENTS_URL = `https://${SAMANTHA_DRESS_HOST}/events`;
// The zone that decides which local day an event belongs to. Mirrors the
// frontend's fallback zone in eventTimeZone(); every current event is in NJ.
export const SAMANTHA_DRESS_TIME_ZONE = "America/New_York";

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
} satisfies CalendarSourceConfig;

// Canonical event deep link, e.g.
// https://samanthadress.com/events/nj/monmouth-county/2026-09-17/<uid>
export function samanthaDressEventUrl(
  event: CalendarEvent,
): string | undefined {
  if (!event.uid) {
    return undefined;
  }

  const location = eventCityLocation(event.location ?? event.address);

  if (!location) {
    return undefined;
  }

  const { state, city: citySlug } = location;
  const date = formatSamanthaDressEventDate(event);
  const uid = encodeURIComponent(event.uid);

  return `${SAMANTHA_DRESS_EVENTS_URL}/${state}/${citySlug}/${date}/${uid}`;
}

// Canonical regional listing page for an event, e.g.
// https://samanthadress.com/events/nj/monmouth-county. Returns undefined when
// the address does not resolve to a real city/state.
export function samanthaDressRegionalUrl(
  event: CalendarEvent,
): string | undefined {
  const location = eventCityLocation(event.location ?? event.address);

  if (!location) {
    return undefined;
  }

  const { state, city: citySlug } = location;

  return `${SAMANTHA_DRESS_EVENTS_URL}/${state}/${citySlug}`;
}

function formatSamanthaDressEventDate(event: CalendarEvent): string {
  if (event.allDay) {
    return event.start.utc().format("YYYY-MM-DD");
  }

  return event.start.tz(SAMANTHA_DRESS_TIME_ZONE).format("YYYY-MM-DD");
}
