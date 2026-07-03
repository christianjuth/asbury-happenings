import * as cheerio from "cheerio";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import ical from "ical-generator";

dayjs.extend(utc);
dayjs.extend(timezone);
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

export type FetchStatus = "hit" | "miss" | "stale" | "error" | "cached" | "warming";

export interface SourcePage {
  sourceUrl: string;
  referenceDate: Date;
}

const htmlCache = new Map<string, HtmlCacheEntry>();
const pendingFetches = new Map<string, Promise<string>>();
const cookieJar = new Map<string, Map<string, string>>();

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

export interface CalendarSourceConfig {
  id: string;
  name: string;
  url: string;
  containerSelector: string;
  selectors: EventSelectorConfig;
  dateFormats?: string[];
  timeFormats?: string[];
  timeZone?: string;
  defaultAddress?: string;
  cacheTtlSeconds?: number;
  defaultDurationMinutes?: number;
}

export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  address?: string;
  url?: string;
}

export async function buildCalendarFeed(config: CalendarSourceConfig, now = new Date()): Promise<string> {
  const { events } = await fetchCalendarEvents(config, now);

  return eventsToIcs(config.name, events);
}

export async function buildCalendarDebugText(config: CalendarSourceConfig, now = new Date()): Promise<string> {
  const { sourceUrls, events, cacheStatuses } = await fetchCalendarEvents(config, now);

  return eventsToDebugText(config.name, sourceUrls, events, cacheStatuses);
}

export async function fetchCalendarEvents(
  config: CalendarSourceConfig,
  now = new Date()
): Promise<{
  sourceUrl: string;
  sourceUrls: string[];
  events: CalendarEvent[];
  cacheStatus: FetchStatus;
  cacheStatuses: FetchStatus[];
}> {
  const sourcePages = renderSourcePages(config.url, now);
  const sourceUrls = sourcePages.map((page) => page.sourceUrl);
  const allEvents: CalendarEvent[] = [];
  const cacheStatuses: FetchStatus[] = [];

  for (const sourcePage of sourcePages) {
    try {
      const { events, cacheStatus } = await fetchCalendarSourcePage(config, sourcePage);

      allEvents.push(...events);
      cacheStatuses.push(cacheStatus);
    } catch (error) {
      if (sourceUrls.length === 1) {
        throw error;
      }

      cacheStatuses.push("error");
    }
  }

  const events = dedupeEvents(allEvents);

  return {
    sourceUrl: sourceUrls[0] ?? config.url,
    sourceUrls,
    events,
    cacheStatus: cacheStatuses[0] ?? "miss",
    cacheStatuses
  };
}

export async function fetchCalendarSourcePage(
  config: CalendarSourceConfig,
  sourcePage: SourcePage
): Promise<{ events: CalendarEvent[]; cacheStatus: FetchStatus }> {
  const { html, cacheStatus } = await fetchSourceHtml(sourcePage.sourceUrl, config.cacheTtlSeconds);
  const events = extractEventsFromHtml(html, config, sourcePage.sourceUrl, sourcePage.referenceDate);

  return { events, cacheStatus };
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
  sourceUrl: string | string[],
  events: CalendarEvent[],
  cacheStatus?: FetchStatus | FetchStatus[]
): string {
  const sourceUrls = Array.isArray(sourceUrl) ? sourceUrl : [sourceUrl];
  const cacheStatuses = Array.isArray(cacheStatus) ? cacheStatus : cacheStatus ? [cacheStatus] : [];
  const lines = [
    `Calendar: ${calendarName}`,
    `Source: ${sourceUrls.join(", ")}`,
    `Fetch: cache ${cacheStatuses.length ? cacheStatuses.join(", ") : "unknown"}`,
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

    if (event.address && event.address !== event.location) {
      lines.push(`Address: ${event.address}`);
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
  cookieJar.clear();
}

async function fetchSourceHtml(
  sourceUrl: string,
  cacheTtlSeconds = defaultCacheTtlSeconds
): Promise<{ html: string; cacheStatus: FetchStatus }> {
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

  const requestHeaders = buildRequestHeaders();
  const cookie = getCookieHeader(sourceUrl);

  if (cookie) {
    requestHeaders.cookie = cookie;
  }

  const pendingFetch = fetch(sourceUrl, {
    headers: requestHeaders
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to fetch ${sourceUrl}: ${response.status}`);
    }

    storeResponseCookies(sourceUrl, response.headers);

    return response.text();
  });

  pendingFetches.set(sourceUrl, pendingFetch);

  try {
    return await pendingFetch;
  } finally {
    pendingFetches.delete(sourceUrl);
  }
}

function buildRequestHeaders(): Record<string, string> {
  return {
    "user-agent": "chaotic-backend/0.1 calendar scraper"
  };
}

function getCookieHeader(sourceUrl: string): string | undefined {
  const hostCookies = cookieJar.get(getCookieHost(sourceUrl));

  if (!hostCookies?.size) {
    return undefined;
  }

  return [...hostCookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function storeResponseCookies(sourceUrl: string, headers: Headers): void {
  const setCookieHeaders = getSetCookieHeaders(headers);

  if (!setCookieHeaders.length) {
    return;
  }

  const host = getCookieHost(sourceUrl);
  const hostCookies = cookieJar.get(host) ?? new Map<string, string>();

  for (const setCookie of setCookieHeaders) {
    const [cookiePair] = setCookie.split(";");
    const separatorIndex = cookiePair.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const name = cookiePair.slice(0, separatorIndex).trim();
    const value = cookiePair.slice(separatorIndex + 1).trim();

    if (name) {
      hostCookies.set(name, value);
    }
  }

  if (hostCookies.size) {
    cookieJar.set(host, hostCookies);
  }
}

function getSetCookieHeaders(headers: Headers): string[] {
  const headersWithSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const setCookieHeaders = headersWithSetCookie.getSetCookie?.();

  if (setCookieHeaders?.length) {
    return setCookieHeaders;
  }

  const setCookie = headers.get("set-cookie");

  return setCookie ? splitSetCookieHeader(setCookie) : [];
}

function splitSetCookieHeader(value: string): string[] {
  return value.split(/,(?=\s*[^;,]+=)/).map((cookie) => cookie.trim()).filter(Boolean);
}

function getCookieHost(sourceUrl: string): string {
  return new URL(sourceUrl).host;
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
      const selected =
        selectorConfig.selector === ":self" ? container.clone() : container.find(selectorConfig.selector).first().clone();

      for (const removeSelector of selectorConfig.remove ?? []) {
        selected.find(removeSelector).remove();
      }

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
        referenceDate,
        requireTimeWhenTimeSelectorProvided: true
      }) ?? addMinutes(start, config.defaultDurationMinutes ?? 60);

    const address = readOptional(config.selectors.address) ?? config.defaultAddress;
    const location = readOptional(config.selectors.location) ?? address;

    events.push({
      title,
      start,
      end,
      description: readOptional(config.selectors.description),
      location,
      address,
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

export function renderSourceUrls(template: string, now = new Date()): string[] {
  return renderSourcePages(template, now).map((page) => page.sourceUrl);
}

export function renderSourcePages(template: string, now = new Date()): SourcePage[] {
  if (!template.includes("{month}")) {
    return [{ sourceUrl: renderSourceUrl(template, now), referenceDate: now }];
  }

  return [0, 1, 2].map((monthOffset) => {
    const referenceDate = addMonths(now, monthOffset);

    return {
      sourceUrl: renderSourceUrl(template, referenceDate),
      referenceDate
    };
  });
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);

  return next;
}

export function dedupeEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  const uniqueEvents: CalendarEvent[] = [];

  for (const event of events) {
    const key = [event.title, event.start.toISOString(), event.url ?? ""].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueEvents.push(event);
  }

  return uniqueEvents;
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
  requireTimeWhenTimeSelectorProvided?: boolean;
}

function readEventDate({
  fullDateTimeSelector,
  dateSelector,
  timeSelector,
  readValue,
  readOptional,
  config,
  referenceDate,
  requireTimeWhenTimeSelectorProvided = false
}: ReadEventDateOptions): Date | null {
  if (fullDateTimeSelector) {
    const value = readOptional(fullDateTimeSelector);

    if (value) {
      return parseDateOrNull(value, fullDateTimeSelector, config.dateFormats, referenceDate, config.timeZone);
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
    if (timeSelector && requireTimeWhenTimeSelectorProvided) {
      return null;
    }

    return parseDateOrNull(dateValue, dateSelector, config.dateFormats, referenceDate, config.timeZone);
  }

  return parseDateAndTimeOrNull(
    dateValue,
    dateSelector,
    timeValue,
    timeSelector,
    config.dateFormats,
    config.timeFormats,
    referenceDate,
    config.timeZone
  );
}

function parseDateOrNull(
  value: string,
  selector: SelectorSpec | undefined,
  fallbackFormats: string[] | undefined,
  referenceDate: Date,
  timeZone?: string
): Date | null {
  for (const format of getDateFormats(selector, fallbackFormats)) {
    const parsed = parseFormattedDate(value, format, referenceDate, timeZone);

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
  referenceDate: Date,
  timeZone?: string
): Date | null {
  for (const dateFormat of getDateFormats(dateSelector, fallbackDateFormats)) {
    for (const timeFormat of getTimeFormats(timeSelector, fallbackTimeFormats)) {
      const parsed = parseFormattedDateTime(dateValue, dateFormat, timeValue, timeFormat, referenceDate, timeZone);

      if (parsed) {
        return parsed;
      }
    }
  }

  return parseDateOrNull(`${dateValue} ${timeValue}`, undefined, fallbackDateFormats, referenceDate, timeZone);
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

function parseFormattedDate(value: string, format: string, referenceDate: Date, timeZone?: string): Date | null {
  const parseValue = formatHasYear(format)
    ? value
    : `${value} ${referenceDate.getUTCFullYear()}`;
  const parseFormat = formatHasYear(format) ? format : `${format} YYYY`;
  const parsed = parseWithOptionalTimeZone(parseValue, parseFormat, timeZone);

  return parsed.isValid() ? parsed.toDate() : null;
}

function parseFormattedDateTime(
  dateValue: string,
  dateFormat: string,
  timeValue: string,
  timeFormat: string,
  referenceDate: Date,
  timeZone?: string
): Date | null {
  const value = formatHasYear(dateFormat)
    ? `${dateValue} ${timeValue}`
    : `${dateValue} ${referenceDate.getUTCFullYear()} ${timeValue}`;
  const format = formatHasYear(dateFormat)
    ? `${dateFormat} ${timeFormat}`
    : `${dateFormat} YYYY ${timeFormat}`;
  const parsed = parseWithOptionalTimeZone(value, format, timeZone);

  return parsed.isValid() ? parsed.toDate() : null;
}

function parseWithOptionalTimeZone(value: string, format: string, timeZone: string | undefined): dayjs.Dayjs {
  if (!timeZone) {
    return dayjs.utc(value, format, true);
  }

  const parsed = dayjs(value, format, true);

  if (!parsed.isValid()) {
    return parsed;
  }

  try {
    return dayjs.tz(parsed.format("YYYY-MM-DD HH:mm:ss"), "YYYY-MM-DD HH:mm:ss", timeZone);
  } catch {
    return parsed;
  }
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
