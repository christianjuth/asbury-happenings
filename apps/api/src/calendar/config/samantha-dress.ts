import type { CalendarSourceConfig } from "../calendar.types.js";

export const SAMANTHA_DRESS_SOURCE = {
  id: "samantha-dress",
  name: "Samantha Dress",
  sourceType: "ics",
  url: "https://calendar.google.com/calendar/ical/65138dbc87c80e90f51e1ad6850a279be725a04b3a71786550afa5e1c38d63fe%40group.calendar.google.com/public/basic.ics",
  browserAllowedOrigins: ["https://samanthadress.com"],
  timeZone: "America/New_York",
  defaultDurationMinutes: 60,
} satisfies CalendarSourceConfig;
