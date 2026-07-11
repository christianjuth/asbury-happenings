import type { CalendarSourceConfig } from "../calendar.types.js";

export const TIM_MCLOONES_SUPPER_CLUB_SOURCE = {
  id: "tim-mcloones-supper-club",
  name: "Tim McLoone's Supper Club",
  sourceType: "html",
  url: "https://timmcloonessupperclub.com/events.php",
  containerSelector: ".events_col2",
  selectors: {
    title: "h2 a",
    startDate: {
      selector: ".event_date",
      pattern: /^[A-Za-z]+,\s*(.+)$/,
      format: "MMMM D",
    },
    startTime: {
      selector: ":self",
      pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
      format: ["h:mma", "h:mm a"],
    },
    endTime: {
      selector: ":self",
      pattern: /-\s*([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
      format: ["h:mma", "h:mm a"],
    },
    description: {
      selector: ":self",
      remove: ["h2", ".event_date", "a", ".btn_events"],
    },
    url: {
      selector: "h2 a",
      attr: "href",
    },
  },
  dateFormats: ["MMMM D"],
  timeZone: "America/New_York",
  defaultAddress:
    "Tim McLoone's Supper Club, 1200 Ocean Avenue, Asbury Park, NJ 07712",
  defaultDurationMinutes: 120,
} satisfies CalendarSourceConfig;
