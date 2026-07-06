import {
  extractSmithMadeEvents,
  extractShowroomComingSoonEvents,
  extractUncorkedWineInspiredEvents,
  stripHtmlFromEventDescription,
  stripHtmlFromEventLocation,
  type CalendarSourceConfig
} from "./calendar.service.js";

const SQUARESPACE_JSON_SOURCE = {
  sourceType: "json",
  fields: {
    title: "title",
    start: "startDate",
    end: "endDate",
    url: "fullUrl"
  },
  dateFormat: "epoch-ms"
} satisfies Partial<CalendarSourceConfig>;

export const CALENDAR_SOURCES = [
  {
    id: "asbury-brickwall",
    name: "Brickwall",
    sourceType: "html",
    url: "https://www.smithmade.org/events/date/{year}-{month}/location/brickwall",
    containerSelector: ".results > div",
    selectors: {
      title: ".event-info h2",
      startDate: ".date .type--h2"
    },
    timeZone: "America/New_York",
    defaultAddress: "Brickwall, 522 Cookman Ave, Asbury Park, NJ 07712",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 300,
    extractEvents: extractSmithMadeEvents
  },
  {
    id: "asbury-lovesick",
    name: "Lovesick",
    sourceType: "html",
    url: "https://www.smithmade.org/events/date/{year}-{month}/location/lovesick",
    containerSelector: ".results > div",
    selectors: {
      title: ".event-info h2",
      startDate: ".date .type--h2"
    },
    timeZone: "America/New_York",
    defaultAddress: "Lovesick, 530 Cookman Ave, Asbury Park, NJ 07712",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 240,
    extractEvents: extractSmithMadeEvents
  },
  {
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
        format: "YYYY-M-DTHH:mm"
      },
      end: {
        selector: ".evo_event_schema meta[itemprop='endDate']",
        attr: "content",
        format: "YYYY-M-DTHH:mm"
      },
      description: {
        selector: ".eventon_desc_in",
        remove: ["iframe"]
      },
      location: {
        selector: ".evcal_desc",
        attr: "data-location_name"
      },
      address: {
        selector: ".evcal_desc",
        attr: "data-location_address"
      },
      url: {
        selector: ".evo_event_schema a[itemprop='url']",
        attr: "href"
      }
    },
    timeZone: "America/New_York",
    defaultAddress: "913 Ocean Avenue, Asbury Park, NJ 07712",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 240
  },
  {
    id: "uncorked-wine-inspired",
    name: "Uncorked Wine Inspired",
    sourceType: "html",
    url: "https://uncorkedwineinspired.com/wp-content/plugins/eventbook/calendar-grid.php",
    containerSelector: ".grid-box",
    selectors: {
      title: "h2",
      start: {
        selector: ".block > div:nth-child(2) > p:nth-of-type(2)",
        pattern: /^([A-Z]+ \d{2}, \d{4} AT \d{1,2}:\d{2}[AP]M)/,
        format: "MMMM DD, YYYY [AT] h:mmA"
      },
      description: ".block > div:nth-child(2) > p:nth-of-type(1)",
      url: {
        selector: "a.btn_info",
        attr: "href"
      }
    },
    timeZone: "America/New_York",
    defaultAddress: "Uncorked Wine Inspired",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 120,
    extractEvents: extractUncorkedWineInspiredEvents
  },
  {
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
    sourceType: "html",
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
  },
  {
    id: "ap-rooftop",
    name: "AP Rooftop",
    sourceType: "html",
    url: "https://aprooftop.com/events.php",
    containerSelector: "#main-content-sub div:has(> .events_col2)",
    selectors: {
      title: ".events_col2 h2",
      startDate: {
        selector: ".event_date, .events_col1",
        pattern: /^(?:[A-Za-z]+,?\s+)?((?:[A-Za-z]+\s+\d{1,2})|(?:\d{1,2}\s+[A-Za-z]+))$/,
        format: ["MMMM D", "D MMMM"]
      },
      startTime: {
        selector: ".events_col2",
        pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
        format: ["h:mma", "h:mm a"]
      },
      endTime: {
        selector: ".events_col2",
        pattern: /-\s*([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
        format: ["h:mma", "h:mm a"]
      },
      description: {
        selector: ".events_col2",
        remove: ["h2", ".event_date", "a"]
      }
    },
    dateFormats: ["MMMM D", "D MMMM"],
    timeZone: "America/New_York",
    defaultAddress: "Arthur Pryor Bandshell, 1200 Ocean Ave, Asbury Park, NJ 07712",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 180
  },
  {
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
        format: "YYYY-MM-DD"
      },
      startTime: {
        selector: ".event-time-localized-start",
        format: ["h:mm A", "h:mm a"]
      },
      endTime: {
        selector: ".event-time-localized-end",
        format: ["h:mm A", "h:mm a"]
      },
      description: ".eventlist-excerpt, .eventlist-description",
      url: {
        selector: ".eventlist-title-link",
        attr: "href"
      }
    },
    timeZone: "America/New_York",
    defaultAddress: "R Bar & Restaurant, 1114 Main St, Asbury Park, NJ 07712",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 180
  },
  {
    id: "wonder-bar",
    name: "Wonder Bar",
    sourceType: "json",
    url: "https://apboardwalk.com/wp-json/apb/v1/shows/64",
    fields: {
      title: "title",
      start: {
        path: "date.start",
        dateFormat: "epoch-seconds"
      },
      description: "details",
      address: "venue.addr",
      url: {
        path: ["ticket", "more"]
      },
      location: "venue.addr"
    },
    timeZone: "America/New_York",
    defaultAddress: "Wonder Bar, 1213 Ocean Ave, Asbury Park, NJ 07712",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 180,
    transformEvent: stripHtmlFromEventDescription
  },
  {
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
        format: "MMM DD"
      },
      startTime: {
        selector: ".rhp-event__time-text--list",
        pattern: /Show:\s*([0-9]{1,2}(?::[0-9]{2})?\s*[ap]m)/i,
        format: ["h:mm a", "h a"]
      },
      endTime: {
        selector: ".rhp-event__time-text--list",
        pattern: /End:\s*([0-9]{1,2}(?::[0-9]{2})?\s*[ap]m)/i,
        format: ["h:mm a", "h a"]
      },
      description: {
        selector: ".belowLowTicketSection",
        remove: [
          ".justAnnouncedIndicate",
          ".eventTitleDiv",
          ".eventAgeRestriction",
          ".rhpEventDetails"
        ]
      },
      url: {
        selector: "#eventTitle",
        attr: "href"
      }
    },
    dateFormats: ["MMM DD"],
    timeZone: "America/New_York",
    defaultAddress: "House of Independents, 572 Cookman Ave, Asbury Park, NJ 07712",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 180
  },
  {
    id: "showroom-cinemas",
    name: "ShowRoom Cinemas",
    sourceType: "html",
    url: "https://showroomcinemas.com/coming-soon/",
    containerSelector: ".show-list > .show-details",
    selectors: {
      title: ".show-title .title",
      startDate: {
        selector: ".selected-date span, .no-showtimes-date",
        pattern: /(?:[A-Za-z]{3},\s*)?((?:[A-Za-z]{3}|[A-Za-z]+)\s+\d{1,2})/i,
        format: ["MMM D", "MMMM D"]
      },
      startTime: {
        selector: ".showtime",
        pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
        format: ["h:mm a", "h:mma"]
      },
      description: ".show-content",
      url: {
        selector: ".show-title .title",
        attr: "href"
      }
    },
    timeZone: "America/New_York",
    defaultAddress: "ShowRoom Cinemas, 707 Cookman Avenue, Asbury Park, NJ 07712",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 120,
    extractEvents: extractShowroomComingSoonEvents
  },
  {
    id: "asbury-park-brewery",
    name: "Asbury Park Brewery",
    ...SQUARESPACE_JSON_SOURCE,
    url: "https://www.asburyparkbrewery.com/api/open/GetItemsByMonth?month={month}-{year}&collectionId=58d9e4bd2e69cf858dea5613",
    timeZone: "America/New_York",
    defaultAddress: "Asbury Park Brewery, 614 Cookman Ave, Asbury Park, NJ 07712",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 180
  },
  {
    id: "black-swan",
    name: "The Black Swan Public House",
    ...SQUARESPACE_JSON_SOURCE,
    url: "https://www.theblackswanap.com/api/open/GetItemsByMonth?month={month}-{year}&collectionId=651eeb68bc08695a75179d3b",
    timeZone: "America/New_York",
    defaultAddress: "The Black Swan Public House, 601 Mattison Avenue, Asbury Park, NJ 07712",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 180
  },
  {
    id: "asbury-lanes",
    name: "Asbury Lanes / Hotel",
    sourceType: "ics",
    url: "https://api.eventcalendarapp.com/widget-subscription/17551/aac3a1a7-2128-4dcb-99b7-31479127235c",
    timeZone: "America/New_York",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 60,
    defaultFilters: ["!open bowling", "!bowling open"]
  },
  {
    id: "asbury-park-city",
    name: "City of Asbury Park",
    sourceType: "ics",
    url: "https://www.cityofasburypark.com/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    timeZone: "America/New_York",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 60,
    transformEvent: stripHtmlFromEventLocation
  },
  {
    id: "samantha-dress",
    name: "Samantha Dress",
    sourceType: "ics",
    url: "https://calendar.google.com/calendar/ical/65138dbc87c80e90f51e1ad6850a279be725a04b3a71786550afa5e1c38d63fe%40group.calendar.google.com/public/basic.ics",
    browserAllowedOrigins: ["https://samanthadress.com"],
    timeZone: "America/New_York",
    cacheTtlSeconds: 900,
    defaultDurationMinutes: 60
  }
] satisfies CalendarSourceConfig[];

export function getCalendarSource(id: string): CalendarSourceConfig | undefined {
  return CALENDAR_SOURCES.find((source) => source.id === id);
}
