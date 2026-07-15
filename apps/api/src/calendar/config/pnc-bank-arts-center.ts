import type { CalendarSourceConfig } from "../calendar.types.js";

export const PNC_BANK_ARTS_CENTER_SOURCE = {
  id: "pnc-bank-arts-center",
  name: "PNC Bank Arts Center",
  sourceType: "json",
  url: "https://content.livenationapi.com/v1/venues/KovZpZAEAIIA/events?offset=0&limit=36",
  fields: {
    title: "name",
    start: {
      path: "start_datetime_utc",
      dateFormat: "iso",
    },
    location: "venue.name",
    url: "url",
  },
  timeZone: "America/New_York",
  defaultAddress:
    "PNC Bank Arts Center, Exit 116, Garden State Pkwy, Holmdel, NJ 07733",
  defaultDurationMinutes: 180,
} satisfies CalendarSourceConfig;
