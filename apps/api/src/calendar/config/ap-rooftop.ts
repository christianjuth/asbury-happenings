import type { CalendarSourceConfig } from "../calendar.types.js";

export const AP_ROOFTOP_SOURCE = {
  id: "ap-rooftop",
  name: "AP Rooftop",
  sourceType: "html",
  url: "https://aprooftop.com/events.php",
  containerSelector: "#main-content-sub div:has(> .events_col2)",
  selectors: {
    title: ".events_col2 h2",
    startDate: {
      selector: ".event_date, .events_col1",
      pattern:
        /^(?:[A-Za-z]+,?\s+)?((?:[A-Za-z]+\s+\d{1,2})|(?:\d{1,2}\s+[A-Za-z]+))$/,
      format: ["MMMM D", "D MMMM"],
    },
    startTime: {
      selector: ".events_col2",
      pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
      format: ["h:mma", "h:mm a"],
    },
    endTime: {
      selector: ".events_col2",
      pattern: /-\s*([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
      format: ["h:mma", "h:mm a"],
    },
    description: {
      selector: ".events_col2",
      remove: ["h2", ".event_date", "a"],
    },
  },
  dateFormats: ["MMMM D", "D MMMM"],
  timeZone: "America/New_York",
  defaultAddress:
    "Arthur Pryor Bandshell, 1200 Ocean Ave, Asbury Park, NJ 07712",
  defaultDurationMinutes: 180,
} satisfies CalendarSourceConfig;
