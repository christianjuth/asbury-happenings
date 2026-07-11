import type { CalendarSourceConfig } from "../calendar.types.js";

export const IRON_WHALE_SOURCE = {
  id: "iron-whale",
  name: "Iron Whale",
  sourceType: "html",
  url: "https://www.ironwhalenj.com/events.php",
  containerSelector: "#main-content-sub div:has(> .events_col2)",
  selectors: {
    title: ".events_col2 > div:nth-child(2) h3",
    startDate: {
      selector: ".events_col2 > div:first-child h3",
      pattern: /^[A-Za-z]+,\s*(.+)$/,
      format: "MMMM D",
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
      remove: ["h3", "a"],
    },
    url: {
      selector: ".events_col2 a",
      attr: "href",
    },
  },
  dateFormats: ["MMMM D"],
  timeZone: "America/New_York",
  defaultAddress: "Iron Whale, 1200 Ocean Avenue, Asbury Park, NJ 07712",
  defaultDurationMinutes: 120,
} satisfies CalendarSourceConfig;
