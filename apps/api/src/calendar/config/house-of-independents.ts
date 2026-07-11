import type { CalendarSourceConfig } from "../calendar.types.js";

export const HOUSE_OF_INDEPENDENTS_SOURCE = {
  id: "house-of-independents",
  name: "House of Independents",
  sourceType: "html",
  url: "https://houseofindependents.com/events/",
  containerSelector: ".eventWrapper.rhpSingleEvent",
  selectors: {
    title: "#eventTitle h2",
    startDate: {
      selector: ".eventDateListTop #eventDate",
      pattern: /^[A-Za-z]{3},\s*(.+)$/,
      format: "MMM DD",
    },
    startTime: {
      selector: ".rhp-event__time-text--list",
      pattern: /Show:\s*([0-9]{1,2}(?::[0-9]{2})?\s*[ap]m)/i,
      format: ["h:mm a", "h a"],
    },
    endTime: {
      selector: ".rhp-event__time-text--list",
      pattern: /End:\s*([0-9]{1,2}(?::[0-9]{2})?\s*[ap]m)/i,
      format: ["h:mm a", "h a"],
    },
    description: {
      selector: ".belowLowTicketSection",
      remove: [
        ".justAnnouncedIndicate",
        ".eventTitleDiv",
        ".eventAgeRestriction",
        ".rhpEventDetails",
      ],
    },
    url: {
      selector: "#eventTitle",
      attr: "href",
    },
  },
  dateFormats: ["MMM DD"],
  timeZone: "America/New_York",
  defaultAddress:
    "House of Independents, 572 Cookman Ave, Asbury Park, NJ 07712",
  defaultDurationMinutes: 180,
} satisfies CalendarSourceConfig;
