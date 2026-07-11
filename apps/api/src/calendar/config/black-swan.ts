import type { CalendarSourceConfig } from "../calendar.types.js";
import { SQUARESPACE_JSON_SOURCE } from "./shared.js";

export const BLACK_SWAN_SOURCE = {
  id: "black-swan",
  name: "The Black Swan Public House",
  ...SQUARESPACE_JSON_SOURCE,
  url: "https://www.theblackswanap.com/api/open/GetItemsByMonth?month={month}-{year}&collectionId=651eeb68bc08695a75179d3b",
  timeZone: "America/New_York",
  defaultAddress:
    "The Black Swan Public House, 601 Mattison Avenue, Asbury Park, NJ 07712",
  defaultDurationMinutes: 180,
} satisfies CalendarSourceConfig;
