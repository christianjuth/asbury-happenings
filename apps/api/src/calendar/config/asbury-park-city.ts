import { stripHtmlFromEventLocation } from "../calendar.post-processing.js";
import type { CalendarSourceConfig } from "../calendar.types.js";

export const ASBURY_PARK_CITY_SOURCE = {
  id: "asbury-park-city",
  name: "City of Asbury Park",
  sourceType: "ics",
  url: "https://www.cityofasburypark.com/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
  timeZone: "America/New_York",
  defaultDurationMinutes: 60,
  transformEvent: stripHtmlFromEventLocation,
} satisfies CalendarSourceConfig;
