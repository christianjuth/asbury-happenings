export type FetchStatus = "hit" | "miss" | "stale" | "error" | "cached" | "warming";

export interface SourcePage {
  sourceUrl: string;
  referenceDate: Date;
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

export interface EventSelectorConfig {
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

export interface JsonEventFieldConfig {
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
  cacheTtlSeconds?: number;
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

export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  description?: string;
  location?: string;
  address?: string;
  url?: string;
}

export type CalendarEventTransform = (event: CalendarEvent) => CalendarEvent | null;
export type CalendarSourceTextExtractor<TConfig extends CalendarSourceConfig> = (
  text: string,
  config: TConfig,
  sourcePage: SourcePage
) => CalendarEvent[];

export type CalendarSourceConfig = HtmlCalendarSourceConfig | JsonCalendarSourceConfig | IcsCalendarSourceConfig;
export type EventFilterInput = string | string[] | undefined;
