import type { CalendarSourceConfig } from "../calendar.types.js";

export const R_BAR_SOURCE = {
  id: "r-bar",
  name: "R Bar",
  sourceType: "html",
  url: "https://www.itsrbar.com/events",
  containerSelector: "article.eventlist-event",
  selectors: {
    title: ".eventlist-title-link",
    startDate: {
      selector: "time.event-date",
      attr: "datetime",
      format: "YYYY-MM-DD",
    },
    startTime: {
      selector: ".event-time-localized-start",
      format: ["h:mm A", "h:mm a"],
    },
    endTime: {
      selector: ".event-time-localized-end",
      format: ["h:mm A", "h:mm a"],
    },
    description: ".eventlist-excerpt, .eventlist-description",
    url: {
      selector: ".eventlist-title-link",
      attr: "href",
    },
  },
  timeZone: "America/New_York",
  defaultAddress: "R Bar & Restaurant, 1114 Main St, Asbury Park, NJ 07712",
  defaultDurationMinutes: 180,
} satisfies CalendarSourceConfig;
