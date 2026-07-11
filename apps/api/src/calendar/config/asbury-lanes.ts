import type { CalendarSourceConfig } from "../calendar.types.js";

export const ASBURY_LANES_SOURCE = {
  id: "asbury-lanes",
  name: "Asbury Lanes / Hotel",
  sourceType: "ics",
  url: "https://api.eventcalendarapp.com/widget-subscription/17551/aac3a1a7-2128-4dcb-99b7-31479127235c",
  timeZone: "America/New_York",
  defaultDurationMinutes: 60,
  defaultFilters: ["!open bowling", "!bowling open"],
} satisfies CalendarSourceConfig;
