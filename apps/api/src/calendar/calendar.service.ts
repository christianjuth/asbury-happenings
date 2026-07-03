import * as cheerio from "cheerio";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import ical from "ical-generator";

dayjs.extend(customParseFormat);

const defaultDateFormats = [
  "ddd, M/D/YYYY",
  "ddd, MM/DD/YYYY",
  "MMM DD",
  "MMM D",
  "MMMM DD",
  "MMMM D",
  "MMM DD YYYY",
  "MMM D YYYY",
  "MMMM DD YYYY",
  "MMMM D YYYY",
  "M/D/YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD"
];

const defaultTimeFormats = ["h:mma", "h:mm a", "ha", "h a", "H:mm", "HH:mm"];
const defaultCacheTtlSeconds = 15 * 60;

interface HtmlCacheEntry {
  html: string;
  expiresAt: number;
}

const htmlCache = new Map<string, HtmlCacheEntry>();
const pendingFetches = new Map<string, Promise<string>>();

export type SelectorSpec =
  | string
  | {
      selector: string;
      attr?: string;
      format?: string | string[];
      pattern?: string | RegExp;
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
  url?: SelectorSpec;
}

export interface CalendarSourceConfig {
  id: string;
  name: string;
  url: string;
  containerSelector: string;
  selectors: EventSelectorConfig;
  dateFormats?: string[];
  timeFormats?: string[];
  cacheTtlSeconds?: number;
  defaultDurationMinutes?: number;
}

export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  url?: string;
}

export async function buildCalendarFeed(config: CalendarSourceConfig, now = new Date()): Promise<string> {
  const { events } = await fetchCalendarEvents(config, now);

  return eventsToIcs(config.name, events);
}

export async function buildCalendarDebugText(config: CalendarSourceConfig, now = new Date()): Promise<string> {
  const { sourceUrl, events, cacheStatus } = await fetchCalendarEvents(config, now);

  return eventsToDebugText(config.name, sourceUrl, events, cacheStatus);
}

export async function fetchCalendarEvents(
  config: CalendarSourceConfig,
  now = new Date()
): Promise<{ sourceUrl: string; events: CalendarEvent[]; cacheStatus: "hit" | "miss" | "stale" }> {
  const sourceUrl = renderSourceUrl(config.url, now);
  const { html, cacheStatus } = await fetchSourceHtml(sourceUrl, config.cacheTtlSeconds);
  const events = extractEventsFromHtml(html, config, sourceUrl, now);

  return { sourceUrl, events, cacheStatus };
}

export function eventsToIcs(calendarName: string, events: CalendarEvent[]): string {
  const calendar = ical({
    name: calendarName,
    prodId: {
      company: "chaotic-backend",
      product: "webpage-calendar"
    }
  });

  for (const event of events) {
    calendar.createEvent({
      summary: event.title,
      start: event.start,
      end: event.end,
      description: event.description,
      location: event.location,
      url: event.url
    });
  }

  return calendar.toString();
}

export function eventsToDebugText(
  calendarName: string,
  sourceUrl: string,
  events: CalendarEvent[],
  cacheStatus?: "hit" | "miss" | "stale"
): string {
  const lines = [
    `Calendar: ${calendarName}`,
    `Source: ${sourceUrl}`,
    `Fetch: cache ${cacheStatus ?? "unknown"}`,
    `Events: ${events.length}`,
    ""
  ];

  for (const [index, event] of events.entries()) {
    lines.push(
      `#${index + 1} ${event.title}`,
      `Start: ${event.start.toISOString()}`,
      `End: ${event.end.toISOString()}`
    );

    if (event.location) {
      lines.push(`Location: ${event.location}`);
    }

    if (event.url) {
      lines.push(`URL: ${event.url}`);
    }

    if (event.description) {
      lines.push(`Description: ${event.description}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

export function clearCalendarFetchCache(): void {
  htmlCache.clear();
  pendingFetches.clear();
}

async function fetchSourceHtml(
  sourceUrl: string,
  cacheTtlSeconds = defaultCacheTtlSeconds
): Promise<{ html: string; cacheStatus: "hit" | "miss" | "stale" }> {
  const now = Date.now();
  const cached = htmlCache.get(sourceUrl);

  if (cached && cached.expiresAt > now) {
    return { html: cached.html, cacheStatus: "hit" };
  }

  try {
    const html = await fetchFreshHtml(sourceUrl);

    htmlCache.set(sourceUrl, {
      html,
      expiresAt: now + cacheTtlSeconds * 1000
    });

    return { html, cacheStatus: "miss" };
  } catch (error) {
    if (cached) {
      return { html: cached.html, cacheStatus: "stale" };
    }

    throw error;
  }
}

async function fetchFreshHtml(sourceUrl: string): Promise<string> {
  const existingFetch = pendingFetches.get(sourceUrl);

  if (existingFetch) {
    return existingFetch;
  }

  const pendingFetch = fetch(sourceUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "chaotic-backend/0.1 calendar scraper"
    }
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to fetch ${sourceUrl}: ${response.status}`);
    }

    return response.text();
  });

  pendingFetches.set(sourceUrl, pendingFetch);

  try {
    return await pendingFetch;
  } finally {
    pendingFetches.delete(sourceUrl);
  }
}

export function extractEventsFromHtml(
  html: string,
  config: CalendarSourceConfig,
  sourceUrl: string,
  referenceDate = new Date()
): CalendarEvent[] {
  const $ = cheerio.load(html);
  const events: CalendarEvent[] = [];

  $(config.containerSelector).each((_, element) => {
    const container = $(element);
    const readValue = (selector: SelectorSpec): string => {
      const selectorConfig = typeof selector === "string" ? { selector } : selector;
      const selected = container.find(selectorConfig.selector).first();
      const rawValue = selectorConfig.attr ? selected.attr(selectorConfig.attr) : selected.text();
      const value = normalizeText(rawValue);

      return applyPattern(value, selectorConfig.pattern);
    };
    const readOptional = (selector?: SelectorSpec): string | undefined => {
      if (!selector) {
        return undefined;
      }

      return readValue(selector) || undefined;
    };

    const title = readValue(config.selectors.title);
    const start = readEventDate({
      fullDateTimeSelector: config.selectors.start,
      dateSelector: config.selectors.startDate,
      timeSelector: config.selectors.startTime,
      readValue,
      readOptional,
      config,
      referenceDate
    });

    if (!title || !start) {
      return;
    }

    const end =
      readEventDate({
        fullDateTimeSelector: config.selectors.end,
        dateSelector: config.selectors.endDate ?? config.selectors.startDate,
        timeSelector: config.selectors.endTime,
        readValue,
        readOptional,
        config,
        referenceDate
      }) ?? addMinutes(start, config.defaultDurationMinutes ?? 60);

    events.push({
      title,
      start,
      end,
      description: readOptional(config.selectors.description),
      location: readOptional(config.selectors.location),
      url: resolveOptionalUrl(readOptional(config.selectors.url), sourceUrl)
    });
  });

  return events;
}

export function renderSourceUrl(template: string, now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const year = String(now.getUTCFullYear());

  return template.replaceAll("{month}", month).replaceAll("{year}", year);
}

function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function applyPattern(value: string, pattern: string | RegExp | undefined): string {
  if (!pattern) {
    return value;
  }

  const regex = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern;
  const match = value.match(regex);

  if (!match) {
    return "";
  }

  return normalizeText(match[1] ?? match[0]);
}

interface ReadEventDateOptions {
  fullDateTimeSelector?: SelectorSpec;
  dateSelector?: SelectorSpec;
  timeSelector?: SelectorSpec;
  readValue(selector: SelectorSpec): string;
  readOptional(selector?: SelectorSpec): string | undefined;
  config: CalendarSourceConfig;
  referenceDate: Date;
}

function readEventDate({
  fullDateTimeSelector,
  dateSelector,
  timeSelector,
  readValue,
  readOptional,
  config,
  referenceDate
}: ReadEventDateOptions): Date | null {
  if (fullDateTimeSelector) {
    const value = readOptional(fullDateTimeSelector);

    if (value) {
      return parseDateOrNull(value, fullDateTimeSelector, config.dateFormats, referenceDate);
    }
  }

  if (!dateSelector) {
    return null;
  }

  const dateValue = readValue(dateSelector);

  if (!dateValue) {
    return null;
  }

  const timeValue = readOptional(timeSelector);

  if (!timeValue) {
    return parseDateOrNull(dateValue, dateSelector, config.dateFormats, referenceDate);
  }

  return parseDateAndTimeOrNull(
    dateValue,
    dateSelector,
    timeValue,
    timeSelector,
    config.dateFormats,
    config.timeFormats,
    referenceDate
  );
}

function parseDateOrNull(
  value: string,
  selector: SelectorSpec | undefined,
  fallbackFormats: string[] | undefined,
  referenceDate: Date
): Date | null {
  for (const format of getDateFormats(selector, fallbackFormats)) {
    const parsed = parseFormattedDate(value, format, referenceDate);

    if (parsed) {
      return parsed;
    }
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function parseDateAndTimeOrNull(
  dateValue: string,
  dateSelector: SelectorSpec,
  timeValue: string,
  timeSelector: SelectorSpec | undefined,
  fallbackDateFormats: string[] | undefined,
  fallbackTimeFormats: string[] | undefined,
  referenceDate: Date
): Date | null {
  for (const dateFormat of getDateFormats(dateSelector, fallbackDateFormats)) {
    for (const timeFormat of getTimeFormats(timeSelector, fallbackTimeFormats)) {
      const parsed = parseFormattedDateTime(dateValue, dateFormat, timeValue, timeFormat, referenceDate);

      if (parsed) {
        return parsed;
      }
    }
  }

  return parseDateOrNull(`${dateValue} ${timeValue}`, undefined, fallbackDateFormats, referenceDate);
}

function getDateFormats(selector: SelectorSpec | undefined, fallbackFormats: string[] | undefined): string[] {
  const selectorFormats =
    typeof selector === "object" && selector.format
      ? Array.isArray(selector.format)
        ? selector.format
        : [selector.format]
      : [];

  return [...new Set([...selectorFormats, ...(fallbackFormats ?? []), ...defaultDateFormats])];
}

function getTimeFormats(selector: SelectorSpec | undefined, fallbackFormats: string[] | undefined): string[] {
  const selectorFormats =
    typeof selector === "object" && selector.format
      ? Array.isArray(selector.format)
        ? selector.format
        : [selector.format]
      : [];

  return [...new Set([...selectorFormats, ...(fallbackFormats ?? []), ...defaultTimeFormats])];
}

function parseFormattedDate(value: string, format: string, referenceDate: Date): Date | null {
  const parseValue = formatHasYear(format)
    ? value
    : `${value} ${referenceDate.getUTCFullYear()}`;
  const parseFormat = formatHasYear(format) ? format : `${format} YYYY`;
  const parsed = dayjs(parseValue, parseFormat, true);

  return parsed.isValid() ? parsed.toDate() : null;
}

function parseFormattedDateTime(
  dateValue: string,
  dateFormat: string,
  timeValue: string,
  timeFormat: string,
  referenceDate: Date
): Date | null {
  const value = formatHasYear(dateFormat)
    ? `${dateValue} ${timeValue}`
    : `${dateValue} ${referenceDate.getUTCFullYear()} ${timeValue}`;
  const format = formatHasYear(dateFormat)
    ? `${dateFormat} ${timeFormat}`
    : `${dateFormat} YYYY ${timeFormat}`;
  const parsed = dayjs(value, format, true);

  return parsed.isValid() ? parsed.toDate() : null;
}

function formatHasYear(format: string): boolean {
  return /Y/.test(format);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function resolveOptionalUrl(value: string | undefined, sourceUrl: string): string | undefined {
  if (!value) {
    return undefined;
  }

  return new URL(value, sourceUrl).toString();
}
