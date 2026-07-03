import * as cheerio from "cheerio";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import ical from "ical-generator";
import lodash from "lodash";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const DEFAULT_DATE_FORMATS = [
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

const DEFAULT_TIME_FORMATS = ["h:mma", "h:mm a", "ha", "h a", "H:mm", "HH:mm"];
const DEFAULT_CACHE_TTL_SECONDS = 15 * 60;

interface SourceTextCacheEntry {
  text: string;
  expiresAt: number;
}

export type FetchStatus = "hit" | "miss" | "stale" | "error" | "cached" | "warming";

export interface SourcePage {
  sourceUrl: string;
  referenceDate: Date;
}

const SOURCE_TEXT_CACHE = new Map<string, SourceTextCacheEntry>();
const PENDING_FETCHES = new Map<string, Promise<string>>();
const COOKIE_JAR = new Map<string, Map<string, string>>();

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
  timeZone?: string;
  defaultAddress?: string;
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
}

export interface JsonCalendarSourceConfig extends BaseCalendarSourceConfig {
  sourceType: "json";
  itemsPath?: string;
  fields: JsonEventFieldConfig;
  dateFormat?: JsonDateFormat;
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

export interface IcsCalendarSourceConfig extends BaseCalendarSourceConfig {
  sourceType: "ics";
}

export type CalendarSourceConfig = HtmlCalendarSourceConfig | JsonCalendarSourceConfig | IcsCalendarSourceConfig;

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
  const { text, cacheStatus } = await fetchSourceText(sourcePage.sourceUrl, config.cacheTtlSeconds);
  const events = applyEventTransform(extractEventsFromSourceText(text, config, sourcePage), config.transformEvent);

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
      allDay: event.allDay,
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
  const sourceUrls = lodash.castArray(sourceUrl);
  const cacheStatuses = cacheStatus ? lodash.castArray(cacheStatus) : [];
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
  SOURCE_TEXT_CACHE.clear();
  PENDING_FETCHES.clear();
  COOKIE_JAR.clear();
}

async function fetchSourceText(
  sourceUrl: string,
  cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS
): Promise<{ text: string; cacheStatus: FetchStatus }> {
  const now = Date.now();
  const cached = SOURCE_TEXT_CACHE.get(sourceUrl);

  if (cached && cached.expiresAt > now) {
    return { text: cached.text, cacheStatus: "hit" };
  }

  try {
    const text = await fetchFreshText(sourceUrl);

    SOURCE_TEXT_CACHE.set(sourceUrl, {
      text,
      expiresAt: now + cacheTtlSeconds * 1000
    });

    return { text, cacheStatus: "miss" };
  } catch (error) {
    if (cached) {
      return { text: cached.text, cacheStatus: "stale" };
    }

    throw error;
  }
}

async function fetchFreshText(sourceUrl: string): Promise<string> {
  const existingFetch = PENDING_FETCHES.get(sourceUrl);

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

  PENDING_FETCHES.set(sourceUrl, pendingFetch);

  try {
    return await pendingFetch;
  } finally {
    PENDING_FETCHES.delete(sourceUrl);
  }
}

function buildRequestHeaders(): Record<string, string> {
  return {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  };
}

function getCookieHeader(sourceUrl: string): string | undefined {
  const hostCookies = COOKIE_JAR.get(getCookieHost(sourceUrl));

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
  const hostCookies = COOKIE_JAR.get(host) ?? new Map<string, string>();

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
    COOKIE_JAR.set(host, hostCookies);
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
  return lodash.compact(value.split(/,(?=\s*[^;,]+=)/).map((cookie) => cookie.trim()));
}

function getCookieHost(sourceUrl: string): string {
  return new URL(sourceUrl).host;
}

export function extractEventsFromHtml(
  html: string,
  config: HtmlCalendarSourceConfig,
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

export function extractEventsFromJson(
  jsonText: string,
  config: JsonCalendarSourceConfig,
  sourceUrl: string
): CalendarEvent[] {
  const payload = JSON.parse(jsonText) as unknown;
  const rawItems = config.itemsPath ? lodash.get(payload, config.itemsPath) : payload;
  const items = Array.isArray(rawItems) ? rawItems : [];

  return lodash.compact(items.map((item) => readJsonEvent(item, config, sourceUrl)));
}

export function extractEventsFromIcs(icsText: string, config: IcsCalendarSourceConfig): CalendarEvent[] {
  return lodash.compact(
    readIcsEventComponents(icsText).map((component) => {
      const title = readIcsText(component, "SUMMARY");
      const start = readIcsDate(component, "DTSTART", config);

      if (!title || !start) {
        return null;
      }

      const end = readIcsDate(component, "DTEND", config) ?? {
        date: addMinutes(start.date, config.defaultDurationMinutes ?? 60),
        allDay: start.allDay
      };
      const location = readIcsText(component, "LOCATION") ?? config.defaultAddress;

      return {
        title,
        start: start.date,
        end: end.date,
        allDay: start.allDay,
        description: readIcsText(component, "DESCRIPTION"),
        location,
        address: location,
        url: readIcsText(component, "URL")
      };
    })
  );
}

export function stripHtmlFromEventLocation(event: CalendarEvent): CalendarEvent {
  const location = event.location ? stripHtml(event.location) : event.location;
  const address = event.address ? stripHtml(event.address) : event.address;

  return {
    ...event,
    location,
    address
  };
}

export function stripHtmlFromEventDescription(event: CalendarEvent): CalendarEvent {
  const description = event.description ? stripHtml(event.description) : event.description;

  return {
    ...event,
    description
  };
}

function extractEventsFromSourceText(text: string, config: CalendarSourceConfig, sourcePage: SourcePage): CalendarEvent[] {
  switch (config.sourceType) {
    case "html":
      return extractEventsFromHtml(text, config, sourcePage.sourceUrl, sourcePage.referenceDate);
    case "json":
      return extractEventsFromJson(text, config, sourcePage.sourceUrl);
    case "ics":
      return extractEventsFromIcs(text, config);
    default:
      return assertNever(config);
  }
}

function applyEventTransform(
  events: CalendarEvent[],
  transformEvent: CalendarEventTransform | undefined
): CalendarEvent[] {
  if (!transformEvent) {
    return events;
  }

  return lodash.compact(events.map((event) => transformEvent(event)));
}

function readJsonEvent(item: unknown, config: JsonCalendarSourceConfig, sourceUrl: string): CalendarEvent | null {
  const title = readJsonText(item, config.fields.title);
  const start = readJsonDate(item, config.fields.start, config.dateFormat);

  if (!title || !start) {
    return null;
  }

  const end =
    readJsonDate(item, config.fields.end, config.dateFormat) ?? addMinutes(start, config.defaultDurationMinutes ?? 60);
  const address = readJsonText(item, config.fields.address) ?? config.defaultAddress;
  const location = readJsonText(item, config.fields.location) ?? address;

  return {
    title,
    start,
    end,
    description: readJsonText(item, config.fields.description),
    location,
    address,
    url: resolveOptionalUrl(readJsonText(item, config.fields.url), sourceUrl)
  };
}

function readJsonText(item: unknown, field: JsonFieldSpec | undefined): string | undefined {
  if (!field) {
    return undefined;
  }

  const value = readJsonValue(item, field);

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return undefined;
  }

  return normalizeText(String(value)) || undefined;
}

function readJsonDate(
  item: unknown,
  field: JsonFieldSpec | undefined,
  fallbackFormat: JsonDateFormat | undefined
): Date | null {
  if (!field) {
    return null;
  }

  return parseJsonDateOrNull(readJsonValue(item, field), getJsonDateFormat(field, fallbackFormat));
}

function readJsonValue(item: unknown, field: JsonFieldSpec): unknown {
  const paths = lodash.castArray(typeof field === "string" ? field : field.path);

  for (const path of paths) {
    const value = lodash.get(item, path);

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

function getJsonDateFormat(field: JsonFieldSpec, fallbackFormat: JsonDateFormat | undefined): JsonDateFormat | undefined {
  return typeof field === "object" ? field.dateFormat ?? fallbackFormat : fallbackFormat;
}

function parseJsonDateOrNull(value: unknown, dateFormat: JsonDateFormat | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const multiplier = dateFormat === "epoch-seconds" ? 1000 : 1;
    const date = new Date(value * multiplier);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return null;
  }

  if (dateFormat === "epoch-ms" || dateFormat === "epoch-seconds") {
    const numericValue = Number(normalizedValue);

    if (!Number.isFinite(numericValue)) {
      return null;
    }

    return parseJsonDateOrNull(numericValue, dateFormat);
  }

  const date = new Date(normalizedValue);

  return Number.isNaN(date.getTime()) ? null : date;
}

interface IcsContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface IcsDateValue {
  date: Date;
  allDay: boolean;
}

function readIcsEventComponents(icsText: string): IcsContentLine[][] {
  const components: IcsContentLine[][] = [];
  let currentComponent: IcsContentLine[] | undefined;

  for (const line of unfoldIcsLines(icsText)) {
    const contentLine = parseIcsContentLine(line);

    if (!contentLine) {
      continue;
    }

    if (contentLine.name === "BEGIN" && contentLine.value.toUpperCase() === "VEVENT") {
      currentComponent = [];
      continue;
    }

    if (contentLine.name === "END" && contentLine.value.toUpperCase() === "VEVENT") {
      if (currentComponent) {
        components.push(currentComponent);
      }

      currentComponent = undefined;
      continue;
    }

    currentComponent?.push(contentLine);
  }

  return components;
}

function unfoldIcsLines(icsText: string): string[] {
  const lines: string[] = [];

  for (const line of icsText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (/^[ \t]/.test(line) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
      continue;
    }

    lines.push(line);
  }

  return lines;
}

function parseIcsContentLine(line: string): IcsContentLine | null {
  const separatorIndex = line.indexOf(":");

  if (separatorIndex <= 0) {
    return null;
  }

  const head = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1);
  const [rawName, ...rawParams] = head.split(";");
  const name = rawName?.toUpperCase();

  if (!name) {
    return null;
  }

  return {
    name,
    params: Object.fromEntries(
      rawParams.map((param) => {
        const [rawKey, ...rawValueParts] = param.split("=");

        return [rawKey.toUpperCase(), rawValueParts.join("=").replace(/^"|"$/g, "")];
      })
    ),
    value
  };
}

function readIcsText(component: IcsContentLine[], name: string): string | undefined {
  const value = component.find((line) => line.name === name)?.value;

  return value ? normalizeText(unescapeIcsText(value)) || undefined : undefined;
}

function readIcsDate(component: IcsContentLine[], name: string, config: IcsCalendarSourceConfig): IcsDateValue | null {
  const line = component.find((contentLine) => contentLine.name === name);

  if (!line) {
    return null;
  }

  return parseIcsDateOrNull(line.value, line.params, config.timeZone);
}

function parseIcsDateOrNull(
  value: string,
  params: Record<string, string>,
  fallbackTimeZone?: string
): IcsDateValue | null {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return null;
  }

  if (params.VALUE === "DATE" || /^\d{8}$/.test(normalizedValue)) {
    const parsed = dayjs.utc(normalizedValue, "YYYYMMDD", true);

    return parsed.isValid() ? { date: parsed.toDate(), allDay: true } : null;
  }

  if (/^\d{8}T\d{6}Z$/.test(normalizedValue)) {
    const parsed = dayjs.utc(normalizedValue, "YYYYMMDDTHHmmss[Z]", true);

    return parsed.isValid() ? { date: parsed.toDate(), allDay: false } : null;
  }

  if (/^\d{8}T\d{6}$/.test(normalizedValue)) {
    const parsed = parseWithOptionalTimeZone(
      normalizedValue,
      "YYYYMMDDTHHmmss",
      normalizeIcsTimeZone(params.TZID, fallbackTimeZone)
    );

    return parsed.isValid() ? { date: parsed.toDate(), allDay: false } : null;
  }

  const date = new Date(normalizedValue);

  return Number.isNaN(date.getTime()) ? null : { date, allDay: false };
}

function normalizeIcsTimeZone(tzid: string | undefined, fallbackTimeZone: string | undefined): string | undefined {
  if (tzid && isValidTimeZone(tzid)) {
    return tzid;
  }

  return fallbackTimeZone;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });

    return true;
  } catch {
    return false;
  }
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\[nN]/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
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

  return lodash.range(3).map((monthOffset) => {
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
  return lodash.uniqBy(events, getEventDedupeKey);
}

function getEventDedupeKey(event: CalendarEvent): string {
  return [event.title, event.start.toISOString(), event.url ?? ""].join("|");
}

function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function stripHtml(value: string): string {
  const $ = cheerio.load(value);

  $("style, script, noscript").remove();
  $("br").replaceWith(" ");
  $("p, div, li, h1, h2, h3, h4, h5, h6").append(" ");

  return normalizeText($.root().text());
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
  config: HtmlCalendarSourceConfig;
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
      ? lodash.castArray(selector.format)
      : [];

  return lodash.uniq([...selectorFormats, ...(fallbackFormats ?? []), ...DEFAULT_DATE_FORMATS]);
}

function getTimeFormats(selector: SelectorSpec | undefined, fallbackFormats: string[] | undefined): string[] {
  const selectorFormats =
    typeof selector === "object" && selector.format
      ? lodash.castArray(selector.format)
      : [];

  return lodash.uniq([...selectorFormats, ...(fallbackFormats ?? []), ...DEFAULT_TIME_FORMATS]);
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

function assertNever(value: never): never {
  throw new Error(`Unsupported calendar source config: ${JSON.stringify(value)}`);
}
