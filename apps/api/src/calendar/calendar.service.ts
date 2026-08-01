import * as cheerio from "cheerio";
import ical, { ICalEventStatus } from "ical-generator";
import _ from "lodash";

import type {
  CalendarEvent,
  CalendarEventStatus,
  CalendarEventTransform,
  CalendarSourceConfig,
  EventFilterInput,
  FetchStatus,
  HtmlCalendarSourceConfig,
  IcsCalendarSourceConfig,
  JsonCalendarSourceConfig,
  JsonDateFormat,
  JsonFieldSpec,
  SelectorSpec,
  SourcePage,
} from "./calendar.types.js";
import {
  normalizeText,
  parseDateAndTimeOrNull,
  parseDateOrNull,
  parseWithOptionalTimeZone,
  resolveOptionalUrl,
} from "./calendar.utils.js";
import dayjs, { type Dayjs } from "./calendar.dates.js";

export type {
  CalendarEvent,
  CalendarSourceConfig,
  EventFilterInput,
  FetchStatus,
  HtmlCalendarSourceConfig,
  IcsCalendarSourceConfig,
  JsonCalendarSourceConfig,
  SourcePage,
} from "./calendar.types.js";

class SourceFetchError extends Error {
  constructor(
    readonly sourceUrl: string,
    readonly status: number,
    readonly text: string,
  ) {
    super(`Failed to fetch ${sourceUrl}: ${status}`);
    this.name = "SourceFetchError";
  }
}

const ICS_EVENT_STATUS: Record<CalendarEventStatus, ICalEventStatus> = {
  confirmed: ICalEventStatus.CONFIRMED,
  tentative: ICalEventStatus.TENTATIVE,
  cancelled: ICalEventStatus.CANCELLED,
};

const PENDING_FETCHES = new Map<string, Promise<string>>();
const COOKIE_JAR = new Map<string, Map<string, string>>();

export async function fetchCalendarEvents(
  config: CalendarSourceConfig,
  now = dayjs(),
): Promise<{
  sourceUrl: string;
  sourceUrls: string[];
  events: CalendarEvent[];
  fetchStatus: FetchStatus;
  fetchStatuses: FetchStatus[];
}> {
  const sourcePages = renderSourcePages(config.url, now);
  const sourceUrls = sourcePages.map((page) => page.sourceUrl);
  const allEvents: CalendarEvent[] = [];
  const fetchStatuses: FetchStatus[] = [];

  for (const sourcePage of sourcePages) {
    try {
      const { events, fetchStatus } = await fetchCalendarSourcePage(
        config,
        sourcePage,
      );

      allEvents.push(...events);
      fetchStatuses.push(fetchStatus);
    } catch (error) {
      if (sourceUrls.length === 1) {
        throw error;
      }

      fetchStatuses.push("error");
    }
  }

  const events = dedupeEvents(allEvents);

  return {
    sourceUrl: sourceUrls[0] ?? config.url,
    sourceUrls,
    events,
    fetchStatus: fetchStatuses[0] ?? "fetched",
    fetchStatuses,
  };
}

export async function fetchCalendarSourcePage(
  config: CalendarSourceConfig,
  sourcePage: SourcePage,
): Promise<{ events: CalendarEvent[]; fetchStatus: FetchStatus }> {
  try {
    const text = await fetchSourceText(sourcePage.sourceUrl);
    const events = applyEventTransform(
      extractEventsFromSourceText(text, config, sourcePage),
      config.transformEvent,
    );

    return { events, fetchStatus: "fetched" };
  } catch (error) {
    if (error instanceof SourceFetchError) {
      const extractedEvents = extractEventsFromSourceText(
        error.text,
        config,
        sourcePage,
      );
      const events = applyEventTransform(
        extractedEvents,
        config.transformEvent,
      );

      if (extractedEvents.length || isEmptySourcePageText(error.text)) {
        return { events, fetchStatus: "fetched" };
      }
    }

    throw error;
  }
}

export function eventsToIcs(
  calendarName: string,
  events: CalendarEvent[],
): string {
  const calendar = ical({
    name: calendarName,
    prodId: {
      company: "calendar-service",
      product: "webpage-calendar",
    },
  });

  for (const event of events) {
    calendar.createEvent({
      id: event.uid,
      summary: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      description: event.description,
      location: event.location,
      url: event.url,
      // samanthadress.com reads STATUS off this feed to render cancellations,
      // so a cancelled source event has to stay cancelled downstream.
      status: event.status ? ICS_EVENT_STATUS[event.status] : undefined,
    });
  }

  return calendar.toString();
}

export function filterCalendarEvents(
  events: CalendarEvent[],
  filters: EventFilterInput,
  defaultFilters: string[] = [],
): CalendarEvent[] {
  const { include, exclude } = parseEventFilters([
    ...defaultFilters,
    ..._.castArray(filters),
  ]);

  if (!include.length && !exclude.length) {
    return events;
  }

  return events.filter((event) => {
    const searchText = getEventSearchText(event);

    if (
      include.length &&
      !include.some((keyword) => searchText.includes(keyword))
    ) {
      return false;
    }

    return !exclude.some((keyword) => searchText.includes(keyword));
  });
}

export function clearCalendarFetchState(): void {
  PENDING_FETCHES.clear();
  COOKIE_JAR.clear();
}

async function fetchSourceText(sourceUrl: string): Promise<string> {
  return fetchFreshText(sourceUrl);
}

async function fetchFreshText(sourceUrl: string): Promise<string> {
  const existingFetch = PENDING_FETCHES.get(sourceUrl);

  if (existingFetch) {
    return existingFetch;
  }

  const requestHeaders = buildRequestHeaders();
  const cookie = getCookieHeader(sourceUrl);

  if (cookie) {
    requestHeaders["cookie"] = cookie;
  }

  const pendingFetch = fetch(sourceUrl, {
    headers: requestHeaders,
  }).then(async (response) => {
    const text = await response.text();

    storeResponseCookies(sourceUrl, response.headers);

    if (!response.ok) {
      throw new SourceFetchError(sourceUrl, response.status, text);
    }

    return text;
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
    // "user-agent":
    //   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  };
}

function isEmptySourcePageText(text: string): boolean {
  const normalizedText = normalizeText(text).toLowerCase();

  return (
    normalizedText.includes("no events found") ||
    normalizedText.includes("page not found")
  );
}

function getCookieHeader(sourceUrl: string): string | undefined {
  const hostCookies = COOKIE_JAR.get(getCookieHost(sourceUrl));

  if (!hostCookies?.size) {
    return undefined;
  }

  return [...hostCookies.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
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

    if (!cookiePair) {
      continue;
    }

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
  const headersWithSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookieHeaders = headersWithSetCookie.getSetCookie?.();

  if (setCookieHeaders?.length) {
    return setCookieHeaders;
  }

  const setCookie = headers.get("set-cookie");

  return setCookie ? splitSetCookieHeader(setCookie) : [];
}

function splitSetCookieHeader(value: string): string[] {
  return _.compact(
    value.split(/,(?=\s*[^;,]+=)/).map((cookie) => cookie.trim()),
  );
}

function parseEventFilters(filters: EventFilterInput): {
  include: string[];
  exclude: string[];
} {
  const include: string[] = [];
  const exclude: string[] = [];

  for (const rawFilter of _.castArray(filters)) {
    const filter = normalizeText(rawFilter);

    if (!filter) {
      continue;
    }

    if (filter.startsWith("!")) {
      const keyword = normalizeFilterKeyword(filter.slice(1));

      if (keyword) {
        exclude.push(keyword);
      }
      continue;
    }

    const keyword = normalizeFilterKeyword(filter);

    if (keyword) {
      include.push(keyword);
    }
  }

  return { include, exclude };
}

function normalizeFilterKeyword(value: string): string {
  return normalizeText(value).toLowerCase();
}

function getEventSearchText(event: CalendarEvent): string {
  return _.compact([event.title, event.location, event.address, event.url])
    .join(" ")
    .toLowerCase();
}

function getCookieHost(sourceUrl: string): string {
  return new URL(sourceUrl).host;
}

export function extractEventsFromHtml(
  html: string,
  config: HtmlCalendarSourceConfig,
  sourceUrl: string,
  referenceDate = dayjs(),
): CalendarEvent[] {
  const $ = cheerio.load(html);
  const events: CalendarEvent[] = [];

  $(config.containerSelector).each((_, element) => {
    const container = $(element);
    const readValue = (selector: SelectorSpec): string => {
      const selectorConfig =
        typeof selector === "string" ? { selector } : selector;
      const selected =
        selectorConfig.selector === ":self"
          ? container.clone()
          : container.find(selectorConfig.selector).first().clone();

      for (const removeSelector of selectorConfig.remove ?? []) {
        selected.find(removeSelector).remove();
      }

      selected.find("br").replaceWith(" ");
      const rawValue = selectorConfig.attr
        ? selected.attr(selectorConfig.attr)
        : selected.text();
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
    const missingStartTime = Boolean(
      config.selectors.startDate &&
      config.selectors.startTime &&
      !readOptional(config.selectors.startTime),
    );
    const start = readEventDate({
      fullDateTimeSelector: config.selectors.start,
      dateSelector: config.selectors.startDate,
      timeSelector: config.selectors.startTime,
      readValue,
      readOptional,
      config,
      referenceDate,
    });

    if (!title || !start) {
      return;
    }

    const end = missingStartTime
      ? start.add(1, "day")
      : (readEventDate({
          fullDateTimeSelector: config.selectors.end,
          dateSelector: config.selectors.endDate ?? config.selectors.startDate,
          timeSelector: config.selectors.endTime,
          readValue,
          readOptional,
          config,
          referenceDate,
          requireTimeWhenTimeSelectorProvided: true,
        }) ?? start.add(config.defaultDurationMinutes ?? 60, "minute"));

    const address =
      readOptional(config.selectors.address) ?? config.defaultAddress;
    const location = readOptional(config.selectors.location) ?? address;

    events.push({
      title: missingStartTime ? `${title} (MISSING TIME)` : title,
      start,
      end,
      allDay: missingStartTime,
      description: readOptional(config.selectors.description),
      location,
      address,
      url: resolveOptionalUrl(readOptional(config.selectors.url), sourceUrl),
    });
  });

  return events;
}

export function extractEventsFromJson(
  jsonText: string,
  config: JsonCalendarSourceConfig,
  sourceUrl: string,
): CalendarEvent[] {
  const payload = JSON.parse(jsonText) as unknown;
  const rawItems = config.itemsPath
    ? _.get(payload, config.itemsPath)
    : payload;
  const items = Array.isArray(rawItems) ? rawItems : [];

  return _.compact(items.map((item) => readJsonEvent(item, config, sourceUrl)));
}

export function extractEventsFromIcs(
  icsText: string,
  config: IcsCalendarSourceConfig,
): CalendarEvent[] {
  return _.compact(
    readIcsEventComponents(icsText).map((component) => {
      const title = readIcsText(component, "SUMMARY");
      const start = readIcsDate(component, "DTSTART", config);

      if (!title || !start) {
        return null;
      }

      const end = readIcsDate(component, "DTEND", config) ?? {
        date: start.date.add(config.defaultDurationMinutes ?? 60, "minute"),
        allDay: start.allDay,
      };
      const location =
        readIcsText(component, "LOCATION") ?? config.defaultAddress;

      return {
        uid: readIcsText(component, "UID"),
        title,
        start: start.date,
        end: end.date,
        allDay: start.allDay,
        description: readIcsText(component, "DESCRIPTION"),
        location,
        address: location,
        url: readIcsText(component, "URL"),
        status: readIcsStatus(component),
      };
    }),
  );
}

function extractEventsFromSourceText(
  text: string,
  config: CalendarSourceConfig,
  sourcePage: SourcePage,
): CalendarEvent[] {
  switch (config.sourceType) {
    case "html":
      return (
        config.extractEvents?.(text, config, sourcePage) ??
        extractEventsFromHtml(
          text,
          config,
          sourcePage.sourceUrl,
          sourcePage.referenceDate,
        )
      );
    case "json":
      return (
        config.extractEvents?.(text, config, sourcePage) ??
        extractEventsFromJson(text, config, sourcePage.sourceUrl)
      );
    case "ics":
      return (
        config.extractEvents?.(text, config, sourcePage) ??
        extractEventsFromIcs(text, config)
      );
    default:
      return assertNever(config);
  }
}

function applyEventTransform(
  events: CalendarEvent[],
  transformEvent: CalendarEventTransform | undefined,
): CalendarEvent[] {
  if (!transformEvent) {
    return events;
  }

  return _.compact(events.map(transformEvent));
}

function readJsonEvent(
  item: unknown,
  config: JsonCalendarSourceConfig,
  sourceUrl: string,
): CalendarEvent | null {
  const title = readJsonText(item, config.fields.title);
  const start = readJsonDate(item, config.fields.start, config.dateFormat);

  if (!title || !start) {
    return null;
  }

  const end =
    readJsonDate(item, config.fields.end, config.dateFormat) ??
    start.add(config.defaultDurationMinutes ?? 60, "minute");
  const address =
    readJsonText(item, config.fields.address) ?? config.defaultAddress;
  const location = readJsonText(item, config.fields.location) ?? address;

  return {
    title,
    start,
    end,
    description: readJsonText(item, config.fields.description),
    location,
    address,
    url: resolveOptionalUrl(readJsonText(item, config.fields.url), sourceUrl),
  };
}

// Normalize text-like JSON fields while treating booleans as missing values.
function readJsonText(
  item: unknown,
  field: JsonFieldSpec | undefined,
): string | undefined {
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
  fallbackFormat: JsonDateFormat | undefined,
): Dayjs | null {
  if (!field) {
    return null;
  }

  return parseJsonDateOrNull(
    readJsonValue(item, field),
    getJsonDateFormat(field, fallbackFormat),
  );
}

function readJsonValue(item: unknown, field: JsonFieldSpec): unknown {
  const paths = _.castArray(typeof field === "string" ? field : field.path);

  for (const path of paths) {
    const value = _.get(item, path);

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

function getJsonDateFormat(
  field: JsonFieldSpec,
  fallbackFormat: JsonDateFormat | undefined,
): JsonDateFormat | undefined {
  return typeof field === "object"
    ? (field.dateFormat ?? fallbackFormat)
    : fallbackFormat;
}

function parseJsonDateOrNull(
  value: unknown,
  dateFormat: JsonDateFormat | undefined,
): Dayjs | null {
  if (dayjs.isDayjs(value)) {
    return value.isValid() ? value : null;
  }

  if (value instanceof Date) {
    const parsed = dayjs(value);

    return parsed.isValid() ? parsed : null;
  }

  if (typeof value === "number") {
    const multiplier = dateFormat === "epoch-seconds" ? 1000 : 1;
    const parsed = dayjs(value * multiplier);

    return parsed.isValid() ? parsed : null;
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

  const parsed = dayjs(normalizedValue);

  return parsed.isValid() ? parsed : null;
}

interface IcsContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface IcsDateValue {
  date: Dayjs;
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

    if (
      contentLine.name === "BEGIN" &&
      contentLine.value.toUpperCase() === "VEVENT"
    ) {
      currentComponent = [];
      continue;
    }

    if (
      contentLine.name === "END" &&
      contentLine.value.toUpperCase() === "VEVENT"
    ) {
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

  for (const line of icsText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")) {
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
      rawParams
        .map((param) => {
          const [rawKey, ...rawValueParts] = param.split("=");

          return rawKey
            ? [
                rawKey.toUpperCase(),
                rawValueParts.join("=").replace(/^"|"$/g, ""),
              ]
            : undefined;
        })
        .filter((entry): entry is [string, string] => Boolean(entry)),
    ),
    value,
  };
}

function readIcsText(
  component: IcsContentLine[],
  name: string,
): string | undefined {
  const value = component.find((line) => line.name === name)?.value;

  return value ? normalizeText(unescapeIcsText(value)) || undefined : undefined;
}

// Cancelled events stay in the feed, so keep STATUS on the event instead of
// dropping it. Downstream consumers use it to tell a cancellation apart from
// an unchanged event.
function readIcsStatus(
  component: IcsContentLine[],
): CalendarEventStatus | undefined {
  const value = readIcsText(component, "STATUS")?.toLowerCase();

  if (value === "confirmed" || value === "tentative" || value === "cancelled") {
    return value;
  }

  return undefined;
}

function readIcsDate(
  component: IcsContentLine[],
  name: string,
  config: IcsCalendarSourceConfig,
): IcsDateValue | null {
  const line = component.find((contentLine) => contentLine.name === name);

  if (!line) {
    return null;
  }

  return parseIcsDateOrNull(line.value, line.params, config.timeZone);
}

function parseIcsDateOrNull(
  value: string,
  params: Record<string, string>,
  fallbackTimeZone?: string,
): IcsDateValue | null {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return null;
  }

  if (params["VALUE"] === "DATE" || /^\d{8}$/.test(normalizedValue)) {
    const parsed = dayjs.utc(normalizedValue, "YYYYMMDD", true);

    return parsed.isValid() ? { date: parsed, allDay: true } : null;
  }

  if (/^\d{8}T\d{6}Z$/.test(normalizedValue)) {
    const parsed = dayjs.utc(normalizedValue, "YYYYMMDDTHHmmss[Z]", true);

    return parsed.isValid() ? { date: parsed, allDay: false } : null;
  }

  if (/^\d{8}T\d{6}$/.test(normalizedValue)) {
    const parsed = parseWithOptionalTimeZone(
      normalizedValue,
      "YYYYMMDDTHHmmss",
      normalizeIcsTimeZone(params["TZID"], fallbackTimeZone),
    );

    return parsed.isValid() ? { date: parsed, allDay: false } : null;
  }

  const parsed = dayjs(normalizedValue);

  return parsed.isValid() ? { date: parsed, allDay: false } : null;
}

function normalizeIcsTimeZone(
  tzid: string | undefined,
  fallbackTimeZone: string | undefined,
): string | undefined {
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

export function renderSourceUrl(template: string, now = dayjs()): string {
  const utcNow = now.utc();
  const month = String(utcNow.month() + 1).padStart(2, "0");
  const year = String(utcNow.year());

  return template.replaceAll("{month}", month).replaceAll("{year}", year);
}

export function renderSourceUrls(template: string, now = dayjs()): string[] {
  return renderSourcePages(template, now).map((page) => page.sourceUrl);
}

export function renderSourcePages(
  template: string,
  now = dayjs(),
): SourcePage[] {
  const utcNow = now.utc();

  if (!template.includes("{month}")) {
    return [
      { sourceUrl: renderSourceUrl(template, utcNow), referenceDate: utcNow },
    ];
  }

  return _.range(3).map((monthOffset) => {
    const referenceDate = utcNow.add(monthOffset, "month");

    return {
      sourceUrl: renderSourceUrl(template, referenceDate),
      referenceDate,
    };
  });
}

export function dedupeEvents(events: CalendarEvent[]): CalendarEvent[] {
  return _.uniqBy(events, getEventDedupeKey);
}

function getEventDedupeKey(event: CalendarEvent): string {
  return [event.title, event.start.toISOString(), event.url ?? ""].join("|");
}

function applyPattern(
  value: string,
  pattern: string | RegExp | undefined,
): string {
  if (!pattern) {
    return value;
  }

  const regex =
    typeof pattern === "string" ? new RegExp(pattern, "i") : pattern;
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
  referenceDate: Dayjs;
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
  requireTimeWhenTimeSelectorProvided = false,
}: ReadEventDateOptions): Dayjs | null {
  if (fullDateTimeSelector) {
    const value = readOptional(fullDateTimeSelector);

    if (value) {
      return parseDateOrNull(
        value,
        fullDateTimeSelector,
        config.dateFormats,
        referenceDate,
        config.timeZone,
      );
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

    return parseDateOrNull(
      dateValue,
      dateSelector,
      config.dateFormats,
      referenceDate,
      config.timeZone,
    );
  }

  return parseDateAndTimeOrNull(
    dateValue,
    dateSelector,
    timeValue,
    timeSelector,
    config.dateFormats,
    config.timeFormats,
    referenceDate,
    config.timeZone,
  );
}

function assertNever(value: never): never {
  throw new Error(
    `Unsupported calendar source config: ${JSON.stringify(value)}`,
  );
}
