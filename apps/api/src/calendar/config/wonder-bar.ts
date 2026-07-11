import { stripHtmlFromEventDescription } from "../calendar.post-processing.js";
import type { CalendarSourceConfig } from "../calendar.types.js";

export const WONDER_BAR_SOURCE = {
  id: "wonder-bar",
  name: "Wonder Bar",
  sourceType: "json",
  url: "https://apboardwalk.com/wp-json/apb/v1/shows/64",
  fields: {
    title: "title",
    start: {
      path: "date.start",
      dateFormat: "epoch-seconds",
    },
    description: "details",
    address: "venue.addr",
    url: {
      path: ["ticket", "more"],
    },
    location: "venue.addr",
  },
  timeZone: "America/New_York",
  defaultAddress: "Wonder Bar, 1213 Ocean Ave, Asbury Park, NJ 07712",
  defaultDurationMinutes: 180,
  transformEvent: stripHtmlFromEventDescription,
} satisfies CalendarSourceConfig;
