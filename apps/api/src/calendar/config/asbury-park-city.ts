import { stripHtmlFromEventLocation } from "../calendar.post-processing.js";
import { rewriteLocation } from "../location-transform.js";
import type { CalendarEvent, CalendarSourceConfig } from "../calendar.types.js";

const ASBURY_PARK_CITY_LOCATION_REWRITES = [
  {
    match: ["press plaza"],
    location: "Press Plaza, 100 Emory St, Asbury Park, NJ 07712",
  },
  {
    match: ["pine street", "between second and third ave"],
    location: "1117 Second Ave, Asbury Park, NJ 07712",
  },
  {
    match: ["pine street", "between 2nd and 3rd ave"],
    location: "1117 Second Ave, Asbury Park, NJ 07712",
  },
  {
    match: ["bangs", "memorial avenues"],
    location: "1 Municipal Plaza, Asbury Park, NJ 07712",
  },
  {
    match: ["city-wide"],
    location: "Asbury Park, NJ 07712",
  },
  {
    match: ["citywide"],
    location: "Asbury Park, NJ 07712",
  },
  // {
  //   match: ["event location", "asbury park"],
  //   location: "",
  // },
  {
    match: ["boardwalk", "first avenue"],
    location: "800 Ocean Ave, Asbury Park, NJ 07712",
  },
  {
    match: ["springwood avenue park"],
    location: "Springwood Avenue Park, 126 Atkins Ave, Asbury Park, NJ 07712",
  },
  {
    match: ["springwood", "atkins"],
    location: "Springwood Avenue Park, 126 Atkins Ave, Asbury Park, NJ 07712",
  },
  {
    match: ["city council chambers"],
    location: "City Hall, 1 Municipal Plaza, Asbury Park, NJ 07712",
  },
  // {
  //   match: ["city manager's conference room"],
  //   location: "",
  // },
  {
    match: ["asbury park high school auditorium"],
    location:
      "Asbury Park High School Auditorium, 1001 Sunset Ave, Asbury Park, NJ 07712",
  },
  {
    match: ["asbury park transportation center"],
    location:
      "Asbury Park Train Station, 801 Springwood Ave, Asbury Park, NJ 07712",
  },
  {
    match: ["dr. robinson towers"],
    location: "Dr. Robinson Towers, 1000 3rd Ave, Asbury Park, NJ 07712",
  },
  {
    match: ["social room", "third avenue"],
    location: "",
  },
  {
    match: ["sunset park"],
    location: "Sunset Park, 1300 Bond St, Asbury Park, NJ 07712",
  },
  {
    match: ["parlor gallery"],
    location: "Parlor Gallery, 717 Cookman Ave, Asbury Park, NJ 07712",
  },
  {
    match: ["stephen crane house"],
    location: "Stephen Crane House, 508 4th Ave, Asbury Park, NJ 07712",
  },
  {
    match: ["interlaken town hall"],
    location:
      "Interlaken Town Hall, 100 Grassmere Avenue, Interlaken, NJ 07712",
  },
  {
    match: ["asbury park public library"],
    location: "Asbury Park Public Library, 500 1st Ave, Asbury Park, NJ 07712",
  },
];

export const ASBURY_PARK_CITY_SOURCE = {
  id: "asbury-park-city",
  name: "City of Asbury Park",
  sourceType: "ics",
  url: "https://www.cityofasburypark.com/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
  timeZone: "America/New_York",
  defaultDurationMinutes: 60,
  transformEvent: transformAsburyParkCityEvent,
} satisfies CalendarSourceConfig;

function transformAsburyParkCityEvent(event: CalendarEvent): CalendarEvent {
  const strippedEvent = stripHtmlFromEventLocation(event);
  const originalLocation = strippedEvent.location;
  const rewrittenLocation = rewriteLocation(
    originalLocation,
    ASBURY_PARK_CITY_LOCATION_REWRITES,
  );

  if (!rewrittenLocation || !originalLocation) {
    return strippedEvent;
  }

  return {
    ...strippedEvent,
    description: prependLocationToDescription(
      originalLocation,
      strippedEvent.description,
    ),
    location: rewrittenLocation,
    address: rewrittenLocation,
  };
}

function prependLocationToDescription(
  location: string,
  description: string | undefined,
): string {
  const locationLine = `Original location: ${location}`;

  return description ? `${locationLine}\n\n${description}` : locationLine;
}
