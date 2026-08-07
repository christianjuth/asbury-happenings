import _ from "lodash";

import {
  cityStateFromLocation,
  venueFromLocation,
} from "../calendar/address.utils.js";
import { getCachedCalendarEventSnapshot } from "../calendar/calendar.cache.js";
// Rendering an ISO string with a zone offset needs dayjs's timezone plugin on the
// prototype. This module imports the configured instance rather than raw dayjs so
// it does not depend on some other importer having installed the plugin first.
import dayjs, { type Dayjs } from "../calendar/calendar.dates.js";
import type {
  CalendarEvent,
  CalendarEventStatus,
  CalendarSourceConfig,
} from "../calendar/calendar.types.js";
import { SAMANTHA_DRESS_SOURCE } from "../calendar/config/samantha-dress.js";
import { timeZoneForState } from "../calendar/state-time-zones.js";
import { lookupCoordinates } from "../geocode/geocode.lookup.js";
import {
  getCoordinateStore,
  type CoordinateStore,
} from "../geocode/geocode.store.js";
import type {
  Coordinates,
  CoordinatesStatus,
} from "../geocode/geocode.types.js";

// Whether the zone is certain or inferred. An explicit TZID is certain; a zone
// derived from the event's state is a guess the UI has to label as one, and the
// site cannot make that call without being told which it got.
type TimeZoneSource = "tzid" | "state" | "default";

interface SamanthaDressDateTime {
  iso: string;
  timeZone: string;
  timeZoneSource: TimeZoneSource;
}

interface SamanthaDressLocation {
  // The verbatim LOCATION line, venue name included. The site hands this to
  // Google/Apple/Waze for directions, and they search better with the venue
  // name, so the geocoder's normalized form must never leak into this field.
  raw: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  // Null is an expected answer, not a failure to paper over. Never substitute a
  // city centroid or any other approximation: absent beats wrong.
  coordinates: Coordinates | null;
  coordinatesStatus: CoordinatesStatus;
}

// Note the absence of the upstream URL property. The ICS feed still publishes it;
// this service deliberately does not, so the Google Calendar link stays masked
// behind an endpoint the site controls. That is the one intentional divergence
// from the ICS feed's payload.
interface SamanthaDressEvent {
  uid: string | null;
  title: string;
  description: string | null;
  status: CalendarEventStatus;
  // Not in the original schema sketch, but the site rebuilds a downloadable .ics
  // from this document and an all-day event has to stay all-day in it.
  allDay: boolean;
  start: SamanthaDressDateTime;
  // When `allDay` is true this is the iCalendar *exclusive* end: a one-day event
  // on the 6th ends at the 7th. That is what the .ics rebuild needs, but it means
  // a consumer rendering a date range has to subtract a day or it will show the
  // event spanning two.
  end: SamanthaDressDateTime;
  location: SamanthaDressLocation;
}

interface SamanthaDressSnapshot {
  generatedAt: string;
  // When the upstream feed was last read successfully. Null before the first
  // successful fetch. Drifting far behind `generatedAt` means upstream is failing
  // and this is last-known-good data.
  sourceFetchedAt: string | null;
  events: SamanthaDressEvent[];
}

// The read path behind `GET /samantha-dress/events`. Deliberately scoped to the
// one calendar: every other source keeps serving ICS only, and this service is
// meant to outlive `/calendar/samantha-dress.ics` rather than generalize to a
// JSON transport for all of them.
export function getSamanthaDressSnapshot(now = dayjs()): SamanthaDressSnapshot {
  // No `filter` querystring, unlike the ICS route: the site reads the whole
  // document and filters per surface. The source's own `defaultFilters` still
  // apply, so the two feeds agree on which events exist.
  const { events, sourceFetchedAt } = getCachedCalendarEventSnapshot(
    SAMANTHA_DRESS_SOURCE,
    undefined,
    now,
  );

  return buildSamanthaDressSnapshot({
    config: SAMANTHA_DRESS_SOURCE,
    events,
    sourceFetchedAt,
    store: getCoordinateStore(),
    now,
  });
}

export function buildSamanthaDressSnapshot(options: {
  config: CalendarSourceConfig;
  events: readonly CalendarEvent[];
  sourceFetchedAt: Dayjs | undefined;
  store: CoordinateStore;
  now: Dayjs;
}): SamanthaDressSnapshot {
  const { config, events, sourceFetchedAt, store, now } = options;

  return {
    generatedAt: now.toISOString(),
    sourceFetchedAt: sourceFetchedAt?.toISOString() ?? null,
    // Every event, past and upcoming: the site filters per surface and needs the
    // past ones for detail pages and performance history.
    //
    // Sorted before rendering. Sorting on the rendered `iso` would compare
    // wall-clock strings carrying different UTC offsets, so a 20:00 show in
    // California would sort ahead of a 22:00 show in New Jersey that starts an
    // hour earlier.
    events: _.sortBy(events, [
      (event) => sortInstant(event, config),
      (event) => event.title,
    ]).map((event) => buildSnapshotEvent(event, config, store, now)),
  };
}

// A timed event has a real instant. An all-day value does not: it is a floating
// date parsed as UTC midnight, which on the east coast is 20:00 the evening
// before — early enough to sort an all-day event ahead of the previous night's
// shows. Anchoring it to midnight in the calendar's own zone puts it back inside
// its own day without giving up instant ordering for everything else.
function sortInstant(
  event: CalendarEvent,
  config: CalendarSourceConfig,
): number {
  if (!event.allDay) {
    return event.start.valueOf();
  }

  return dayjs
    .tz(event.start.utc().format("YYYY-MM-DD"), config.timeZone ?? "UTC")
    .valueOf();
}

function buildSnapshotEvent(
  event: CalendarEvent,
  config: CalendarSourceConfig,
  store: CoordinateStore,
  now: Dayjs,
): SamanthaDressEvent {
  const raw = event.location ?? event.address;
  const allDay = Boolean(event.allDay);
  // Parsed once and threaded down. `addresser` is not cheap and both the time
  // zone inference and the published city/state want the same answer; the whole
  // point of this service is to stop paying per-request address costs.
  const [city, state] = splitCityState(raw);
  const inferredTimeZone = inferTimeZone(state, config);

  return {
    uid: event.uid ?? null,
    title: event.title,
    description: event.description ?? null,
    // Cancelled events stay in the document — the site renders them struck
    // through — so this has to carry STATUS rather than filter on it.
    status: event.status ?? "confirmed",
    allDay,
    start: buildSnapshotDateTime(
      event.start,
      event.startTimeZone,
      inferredTimeZone,
      allDay,
    ),
    end: buildSnapshotDateTime(
      event.end,
      event.endTimeZone,
      inferredTimeZone,
      allDay,
    ),
    location: buildSnapshotLocation(
      raw,
      city,
      state,
      store,
      event.end.isBefore(now),
    ),
  };
}

function buildSnapshotLocation(
  raw: string | undefined,
  city: string | null,
  state: string | null,
  store: CoordinateStore,
  past: boolean,
): SamanthaDressLocation {
  const { coordinates, status } = lookupCoordinates(store, raw, { past });

  return {
    raw: raw ?? null,
    venue: venueFromLocation(raw),
    city,
    state,
    coordinates,
    coordinatesStatus: status,
  };
}

function buildSnapshotDateTime(
  value: Dayjs,
  explicitTimeZone: string | undefined,
  inferredTimeZone: { timeZone: string; source: TimeZoneSource },
  allDay: boolean,
): SamanthaDressDateTime {
  // An all-day value is a floating date. Rendering it in a local zone would move
  // it onto the previous evening, so it stays the UTC midnight it was parsed as
  // and the consumer reads `allDay` to know it is date-only.
  if (allDay) {
    return {
      iso: value.utc().format(),
      timeZone: "UTC",
      timeZoneSource: "default",
    };
  }

  if (explicitTimeZone) {
    return {
      iso: value.tz(explicitTimeZone).format(),
      timeZone: explicitTimeZone,
      timeZoneSource: "tzid",
    };
  }

  return {
    iso: value.tz(inferredTimeZone.timeZone).format(),
    timeZone: inferredTimeZone.timeZone,
    timeZoneSource: inferredTimeZone.source,
  };
}

// Google Calendar publishes UTC instants with no TZID, so the instant is exact
// but the zone to display it in is not carried by the feed. The event's state is
// the best available signal, and falling back to the source's configured zone is
// the last resort.
function inferTimeZone(
  state: string | null,
  config: CalendarSourceConfig,
): { timeZone: string; source: TimeZoneSource } {
  const stateTimeZone = timeZoneForState(state ?? undefined);

  if (stateTimeZone) {
    return { timeZone: stateTimeZone, source: "state" };
  }

  return { timeZone: config.timeZone ?? "UTC", source: "default" };
}

// Parsed once here rather than re-derived per request on the website.
function splitCityState(
  raw: string | undefined,
): [string | null, string | null] {
  const cityState = cityStateFromLocation(raw);

  if (!cityState) {
    return [null, null];
  }

  const [city, state] = cityState.split(",").map((part) => part.trim());

  return [city ?? null, state ?? null];
}
