import type { CalendarSourceConfig } from "./calendar.service.js";

export const calendarSources = [
  {
    id: "example-events",
    name: "Example Events",
    url: "https://example.com/events/{year}/{month}",
    containerSelector: "article",
    selectors: {
      title: ".event-title",
      start: {
        selector: "time.start",
        attr: "datetime",
        format: "YYYY-MM-DDTHH:mm:ss[Z]"
      },
      end: {
        selector: "time.end",
        attr: "datetime",
        format: "YYYY-MM-DDTHH:mm:ss[Z]"
      },
      location: ".location",
      description: ".description",
      url: {
        selector: "a.details",
        attr: "href"
      }
    },
    dateFormats: ["MMM DD"],
    timeZone: "UTC",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 60
  },
  {
    id: "asbury-book-coop",
    name: "Asbury Book Coop",
    url: "https://asburybookcoop.com/events/{year}/{month}",
    containerSelector: "article.event-list",
    selectors: {
      title: ".event-list__title",
      startDate: {
        selector: ".event-list__details",
        pattern: /[A-Za-z]{3},\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
        format: "M/D/YYYY"
      },
      startTime: {
        selector: ".event-list__details",
        pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)\s*-/i,
        format: ["h:mma", "h:mm a"]
      },
      endTime: {
        selector: ".event-list__details",
        pattern: /-\s*([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
        format: ["h:mma", "h:mm a"]
      },
      location: ".location",
      address: {
        selector: "address",
        pattern: /.*$/i
      },
      description: {
        selector: ".event-list__body",
        remove: [
          ".event-list__title",
          ".event-list__details",
          ".event-list__links",
          ".event-list__links--event"
        ]
      },
      url: {
        selector: "a.event-list__links--event",
        attr: "href"
      }
    },
    dateFormats: ["MMM DD", "MMM D", "MMMM DD", "MMMM D"],
    timeZone: "America/New_York",
    defaultAddress: "Asbury Book Cooperative, 644A Cookman Ave, Asbury Park, NJ 07712",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 60
  },
  {
    id: "tim-mcloones-supper-club",
    name: "Tim McLoone's Supper Club",
    url: "https://timmcloonessupperclub.com/events.php",
    containerSelector: ".events_col2",
    selectors: {
      title: "h2 a",
      startDate: {
        selector: ".event_date",
        pattern: /^[A-Za-z]+,\s*(.+)$/,
        format: "MMMM D"
      },
      startTime: {
        selector: ":self",
        pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
        format: ["h:mma", "h:mm a"]
      },
      endTime: {
        selector: ":self",
        pattern: /-\s*([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
        format: ["h:mma", "h:mm a"]
      },
      description: {
        selector: ":self",
        remove: ["h2", ".event_date", "a", ".btn_events"]
      },
      url: {
        selector: "h2 a",
        attr: "href"
      }
    },
    dateFormats: ["MMMM D"],
    timeZone: "America/New_York",
    defaultAddress: "Tim McLoone's Supper Club, 1200 Ocean Avenue, Asbury Park, NJ 07712",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 120
  }
] satisfies CalendarSourceConfig[];

export function getCalendarSource(id: string): CalendarSourceConfig | undefined {
  return calendarSources.find((source) => source.id === id);
}
