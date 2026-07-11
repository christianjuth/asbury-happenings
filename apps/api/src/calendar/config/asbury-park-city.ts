import { stripHtmlFromEventLocation } from "../calendar.post-processing.js";
import { rewriteLocation } from "../location-transform.js";
import type { CalendarEvent, CalendarSourceConfig } from "../calendar.types.js";

const ASBURY_PARK_CITY_LOCATION_REWRITES = [
  {
    match: ["press plaza"],
    location: "Press Plaza, 100 Emory St Asbury Park, NJ  07712, United States",
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
