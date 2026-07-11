import type { CalendarSourceConfig } from "../calendar.types.js";

export const STONE_PONY_SOURCE = {
  id: "stone-pony",
  name: "The Stone Pony",
  sourceType: "html",
  url: "https://www.stoneponyonline.com/calendar/",
  containerSelector: ".eventon_list_event",
  selectors: {
    title: ".evo_event_schema > span[itemprop='name']",
    start: {
      selector: ".evo_event_schema meta[itemprop='startDate']",
      attr: "content",
      format: "YYYY-M-DTHH:mm",
    },
    end: {
      selector: ".evo_event_schema meta[itemprop='endDate']",
      attr: "content",
      format: "YYYY-M-DTHH:mm",
    },
    description: {
      selector: ".eventon_desc_in",
      remove: ["iframe"],
    },
    location: {
      selector: ".evcal_desc",
      attr: "data-location_name",
    },
    address: {
      selector: ".evcal_desc",
      attr: "data-location_address",
    },
    url: {
      selector: ".evo_event_schema a[itemprop='url']",
      attr: "href",
    },
  },
  timeZone: "America/New_York",
  defaultAddress: "913 Ocean Avenue, Asbury Park, NJ 07712",
  defaultDurationMinutes: 240,
} satisfies CalendarSourceConfig;
