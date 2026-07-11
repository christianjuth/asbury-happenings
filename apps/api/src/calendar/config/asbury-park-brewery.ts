import type { CalendarSourceConfig } from "../calendar.types.js";
import { SQUARESPACE_JSON_SOURCE } from "./shared.js";

export const ASBURY_PARK_BREWERY_SOURCE = {
  id: "asbury-park-brewery",
  name: "Asbury Park Brewery",
  ...SQUARESPACE_JSON_SOURCE,
  url: "https://www.asburyparkbrewery.com/api/open/GetItemsByMonth?month={month}-{year}&collectionId=58d9e4bd2e69cf858dea5613",
  timeZone: "America/New_York",
  defaultAddress: "Asbury Park Brewery, 614 Cookman Ave, Asbury Park, NJ 07712",
  defaultDurationMinutes: 180,
} satisfies CalendarSourceConfig;
