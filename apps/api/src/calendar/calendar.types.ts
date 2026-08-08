import type { Dayjs } from "./calendar.dates.js";

export type FetchStatus = "fetched" | "stale" | "error" | "warming";

export interface SourcePage {
  sourceUrl: string;
  referenceDate: Dayjs;
}

export type SelectorSpec =
  | string
  | {
      selector: string;
      attr?: string;
      format?: string | string[];
      pattern?: string | RegExp;
      remove?: string[];
    };

interface EventSelectorConfig {
  title: SelectorSpec;
  start?: SelectorSpec;
  startDate?: SelectorSpec;
  startTime?: SelectorSpec;
  end?: SelectorSpec;
  endDate?: SelectorSpec;
  endTime?: SelectorSpec;
  description?: SelectorSpec;
  location?: SelectorSpec;
  address?: SelectorSpec;
  url?: SelectorSpec;
}

export type JsonDateFormat = "epoch-ms" | "epoch-seconds" | "iso";

export type JsonFieldSpec =
  | string
  | {
      path: string | string[];
      dateFormat?: JsonDateFormat;
    };

interface JsonEventFieldConfig {
  title: JsonFieldSpec;
  start: JsonFieldSpec;
  end?: JsonFieldSpec;
  description?: JsonFieldSpec;
  location?: JsonFieldSpec;
  address?: JsonFieldSpec;
  url?: JsonFieldSpec;
}

interface BaseCalendarSourceConfig {
  id: string;
  name: string;
  url: string;
  browserAllowedOrigins?: string[];
  timeZone?: string;
  defaultAddress?: string;
  defaultFilters?: string[];
  defaultDurationMinutes?: number;
  transformEvent?: CalendarEventTransform;
}

export interface HtmlCalendarSourceConfig extends BaseCalendarSourceConfig {
  sourceType: "html";
  containerSelector: string;
  selectors: EventSelectorConfig;
  dateFormats?: string[];
  timeFormats?: string[];
  extractEvents?: CalendarSourceTextExtractor<HtmlCalendarSourceConfig>;
}

export interface JsonCalendarSourceConfig extends BaseCalendarSourceConfig {
  sourceType: "json";
  itemsPath?: string;
  fields: JsonEventFieldConfig;
  dateFormat?: JsonDateFormat;
  extractEvents?: CalendarSourceTextExtractor<JsonCalendarSourceConfig>;
}

export interface IcsCalendarSourceConfig extends BaseCalendarSourceConfig {
  sourceType: "ics";
  extractEvents?: CalendarSourceTextExtractor<IcsCalendarSourceConfig>;
}

export type CalendarEventStatus = "confirmed" | "tentative" | "cancelled";

// How the source expressed the time, which is not recoverable from the parsed
// instant afterwards. `utc` and `tzid` both pin a real moment; `floating` is a
// wall clock with no zone attached, which parsing had to place in *some* zone to
// produce an instant at all — the one case where a wrong zone is baked in
// unrecoverably, so it must stay visible. Set by the ICS reader only.
export type CalendarTimeSource = "utc" | "tzid" | "floating" | "date";

export interface CalendarEvent {
  uid?: string;
  title: string;
  start: Dayjs;
  end: Dayjs;
  allDay?: boolean;
  description?: string;
  location?: string;
  address?: string;
  url?: string;
  status?: CalendarEventStatus;
  // Set only when the source carried an explicit, valid TZID for that date.
  // A missing value means the feed did not say which zone the wall-clock time
  // belongs to, so the JSON snapshot has to infer a display zone and label it as
  // inferred. Never backfilled from a config default; that would erase the
  // difference between a certain zone and a guess.
  startTimeZone?: string;
  endTimeZone?: string;
  startTimeSource?: CalendarTimeSource;
  endTimeSource?: CalendarTimeSource;
}

export type CalendarEventTransform = (
  event: CalendarEvent,
) => CalendarEvent | null;
type CalendarSourceTextExtractor<TConfig extends CalendarSourceConfig> = (
  text: string,
  config: TConfig,
  sourcePage: SourcePage,
) => CalendarEvent[];

export type CalendarSourceConfig =
  HtmlCalendarSourceConfig | JsonCalendarSourceConfig | IcsCalendarSourceConfig;
export type EventFilterInput = string | string[] | undefined;
