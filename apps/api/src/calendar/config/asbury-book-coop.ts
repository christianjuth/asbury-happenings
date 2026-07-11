import type { CalendarSourceConfig } from "../calendar.types.js";

export const ASBURY_BOOK_COOP_SOURCE = {
  id: "asbury-book-coop",
  name: "Asbury Book Coop",
  sourceType: "html",
  url: "https://asburybookcoop.com/events/{year}/{month}",
  containerSelector: "article.event-list",
  selectors: {
    title: ".event-list__title",
    startDate: {
      selector: ".event-list__details",
      pattern: /[A-Za-z]{3},\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
      format: "M/D/YYYY",
    },
    startTime: {
      selector: ".event-list__details",
      pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)\s*-/i,
      format: ["h:mma", "h:mm a"],
    },
    endTime: {
      selector: ".event-list__details",
      pattern: /-\s*([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
      format: ["h:mma", "h:mm a"],
    },
    location: ".location",
    address: {
      selector: "address",
      pattern: /.*$/i,
    },
    description: {
      selector: ".event-list__body",
      remove: [
        ".event-list__title",
        ".event-list__details",
        ".event-list__links",
        ".event-list__links--event",
      ],
    },
    url: {
      selector: "a.event-list__links--event",
      attr: "href",
    },
  },
  dateFormats: ["MMM DD", "MMM D", "MMMM DD", "MMMM D"],
  timeZone: "America/New_York",
  defaultAddress:
    "Asbury Book Cooperative, 644A Cookman Ave, Asbury Park, NJ 07712",
  defaultDurationMinutes: 60,
} satisfies CalendarSourceConfig;
