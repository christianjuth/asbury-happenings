import type { CalendarSourceConfig } from "../calendar.types.js";
import { AP_ROOFTOP_SOURCE } from "./ap-rooftop.js";
import { ART629_SOURCE } from "./art629.js";
import { ASBURY_BOOK_COOP_SOURCE } from "./asbury-book-coop.js";
import { ASBURY_BRICKWALL_SOURCE } from "./asbury-brickwall.js";
import { ASBURY_LANES_SOURCE } from "./asbury-lanes.js";
import { ASBURY_LOVESICK_SOURCE } from "./asbury-lovesick.js";
import { ASBURY_PARK_BREWERY_SOURCE } from "./asbury-park-brewery.js";
import { ASBURY_PARK_CITY_SOURCE } from "./asbury-park-city.js";
import { BLACK_SWAN_SOURCE } from "./black-swan.js";
import { HOUSE_OF_INDEPENDENTS_SOURCE } from "./house-of-independents.js";
import { IRON_WHALE_SOURCE } from "./iron-whale.js";
import { R_BAR_SOURCE } from "./r-bar.js";
import { SAMANTHA_DRESS_SOURCE } from "./samantha-dress.js";
import { SHOWROOM_CINEMAS_SOURCE } from "./showroom-cinemas.js";
import { STONE_PONY_SOURCE } from "./stone-pony.js";
import { TIM_MCLOONES_SUPPER_CLUB_SOURCE } from "./tim-mcloones-supper-club.js";
import { UNCORKED_WINE_INSPIRED_SOURCE } from "./uncorked-wine-inspired.js";
import { WONDER_BAR_SOURCE } from "./wonder-bar.js";

export const CALENDAR_SOURCES = [
  ASBURY_BRICKWALL_SOURCE,
  ASBURY_LOVESICK_SOURCE,
  STONE_PONY_SOURCE,
  UNCORKED_WINE_INSPIRED_SOURCE,
  ASBURY_BOOK_COOP_SOURCE,
  TIM_MCLOONES_SUPPER_CLUB_SOURCE,
  AP_ROOFTOP_SOURCE,
  IRON_WHALE_SOURCE,
  R_BAR_SOURCE,
  WONDER_BAR_SOURCE,
  HOUSE_OF_INDEPENDENTS_SOURCE,
  SHOWROOM_CINEMAS_SOURCE,
  ART629_SOURCE,
  ASBURY_PARK_BREWERY_SOURCE,
  BLACK_SWAN_SOURCE,
  ASBURY_LANES_SOURCE,
  ASBURY_PARK_CITY_SOURCE,
  SAMANTHA_DRESS_SOURCE,
] satisfies CalendarSourceConfig[];

export function getCalendarSource(
  id: string,
): CalendarSourceConfig | undefined {
  return CALENDAR_SOURCES.find((source) => source.id === id);
}
