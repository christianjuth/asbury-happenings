import _ from "lodash";

import {
  cityStateFromLocation,
  venueFromLocation,
} from "../calendar/address.utils.js";
// Rendering an ISO string with a zone offset needs dayjs's timezone plugin on the
// prototype. This module imports the configured instance rather than raw dayjs so
// it does not depend on some other importer having installed the plugin first.
import dayjs, { type Dayjs } from "../calendar/calendar.dates.js";
import {
  eventEndDate,
  eventEndInTimeZone,
} from "../calendar/calendar.utils.js";
import type {
  CalendarEvent,
  CalendarEventStatus,
  CalendarSourceConfig,
} from "../calendar/calendar.types.js";
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
import {
  cancelledFromTitle,
  timeUnknownFromTitle,
} from "./samantha-dress.title.js";
import { getSamanthaDressEventSnapshot } from "./samantha-dress.cache.js";
import { SAMANTHA_DRESS_SOURCE } from "./samantha-dress.config.js";

// Whether the zone is certain or inferred. An explicit TZID is certain; a zone
// derived from the event's state is a guess the UI has to label as one, and the
// site cannot make that call without being told which it got.
type TimeZoneSource = "tzid" | "state" | "default";

// An all-day event is a calendar date and a timed event is an instant. They are
// different kinds of value, so they are published as different shapes rather
// than as one shape where a date is written as midnight in some zone and the
// consumer is trusted never to convert it. `allDay` says which to expect.
export type SamanthaDressDateTime = SamanthaDressDate | SamanthaDressInstant;

interface SamanthaDressDate {
  // The day itself. No instant, so there is nothing here to convert and nothing
  // to convert wrongly.
  date: string;
  // The venue's zone, for the one question a date cannot answer on its own:
  // when the day starts and ends. "Is this event over?" needs a boundary, and
  // without this the consumer has to pick some zone of its own — which retires
  // an all-day show at a Pacific venue three hours early on its last day.
  //
  // Never for rendering. `date` is what gets displayed; this only turns the day
  // into an interval. Inferred like any other zone (the venue's state, or the
  // calendar's own zone when the address parses to no state), and deliberately
  // published without `timeZoneSource` or `timeZoneAmbiguous`: an hour of
  // uncertainty does not matter when the question is which midnight.
  timeZone: string;
}

interface SamanthaDressInstant {
  iso: string;
  timeZone: string;
  timeZoneSource: TimeZoneSource;
  // Whether this zone could be the wrong one for the venue. False when the feed
  // stated the zone; true when it was inferred from a state that has more than
  // one, or when nothing about the location was parseable and the source's own
  // zone was the fallback. The site uses it to decide whether to caption a time
  // with the zone it is shown in.
  timeZoneAmbiguous: boolean;
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
  // True when `coordinates` was set by hand in the override table rather than
  // geocoded. Always false when there are no coordinates to have set. The two
  // pins render identically; this is what tells an operator which addresses we
  // are maintaining ourselves, and which ones stop being maintained the day the
  // row is deleted.
  coordinatesManual: boolean;
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
  // from this document and an all-day event has to stay all-day in it. Also the
  // discriminant for `start`/`end`: true means both carry a `date`.
  allDay: boolean;
  // The title says the start time has not been announced yet, so the instants
  // below are the calendar's placeholder rather than a real time. Render the
  // date without a clock and do not count down to it.
  timeUnknown: boolean;
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
  return buildSamanthaDressSnapshot(readSnapshotOptions(now));
}

// Shared by the published document and its debug view so both describe the same
// read of the cache.
export function readSnapshotOptions(now: Dayjs): SamanthaDressSnapshotOptions {
  // Unlike the generic calendar read path, v2 publishes the parsed VEVENTs
  // directly: no query/default filters, transforms or calendar-level dedupe.
  // The site filters per surface, and duplicate source entries stay visible.
  const { events, sourceFetchedAt } = getSamanthaDressEventSnapshot();

  return {
    config: SAMANTHA_DRESS_SOURCE,
    events,
    sourceFetchedAt,
    store: getCoordinateStore(),
    now,
  };
}

export interface SamanthaDressSnapshotOptions {
  config: CalendarSourceConfig;
  events: readonly CalendarEvent[];
  sourceFetchedAt: Dayjs | undefined;
  store: CoordinateStore;
  now: Dayjs;
}

export function buildSamanthaDressSnapshot(
  options: SamanthaDressSnapshotOptions,
): SamanthaDressSnapshot {
  return {
    generatedAt: options.now.toISOString(),
    sourceFetchedAt: options.sourceFetchedAt?.toISOString() ?? null,
    events: buildSnapshotEvents(options).map((event) => event.published),
  };
}

// The source event alongside what got published for it. The debug view reads
// these pairs so it reports the document the site actually receives rather than
// a second rendering of it that could disagree.
interface SamanthaDressSnapshotEvent {
  source: CalendarEvent;
  published: SamanthaDressEvent;
}

export function buildSnapshotEvents(
  options: SamanthaDressSnapshotOptions,
): SamanthaDressSnapshotEvent[] {
  const { config, events, store, now } = options;

  // Every event, past and upcoming: the site filters per surface and needs the
  // past ones for detail pages and performance history.
  //
  // Built before sorting, so ordering reads the same day boundary the document
  // publishes rather than deriving a second one.
  return _.sortBy(
    events.map((event) => ({
      source: event,
      published: buildSnapshotEvent(event, config, store, now),
    })),
    [sortInstant, (entry) => entry.published.title],
  );
}

// Sorting on the rendered `iso` would compare wall-clock strings carrying
// different UTC offsets, so a 20:00 show in California would sort ahead of a
// 22:00 show in New Jersey that starts an hour earlier — hence a real instant
// per event.
//
// An all-day event has no instant. Read as the UTC midnight it parsed as, it
// would land at 20:00 the evening before on the east coast, early enough to sort
// ahead of the previous night's shows. Midnight at its own venue puts it back
// inside its own day.
function sortInstant(entry: SamanthaDressSnapshotEvent): number {
  const { start } = entry.published;

  return "date" in start
    ? dayjs.tz(start.date, start.timeZone).valueOf()
    : entry.source.start.valueOf();
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
  const end = allDay ? dayjs.utc(eventEndDate(event)) : event.end;

  return {
    uid: event.uid ?? null,
    title: event.title,
    description: event.description ?? null,
    // Cancelled events stay in the document — the site renders them struck
    // through — so this has to carry STATUS rather than filter on it. A title
    // carrying the cancellation instead is folded in here, so the site reads one
    // field; `?debug=1` shows which of the two answered.
    status: buildSnapshotStatus(event),
    allDay,
    timeUnknown: timeUnknownFromTitle(event.title),
    start: buildSnapshotDateTime(
      event.start,
      event.startTimeZone,
      inferredTimeZone,
      allDay,
    ),
    end: buildSnapshotDateTime(
      end,
      event.endTimeZone,
      inferredTimeZone,
      allDay,
    ),
    location: buildSnapshotLocation(
      raw,
      city,
      state,
      store,
      eventEndInTimeZone(event, config.timeZone ?? "UTC").isBefore(now),
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
  const { coordinates, status, manual } = lookupCoordinates(store, raw, {
    past,
  });

  return {
    raw: raw ?? null,
    venue: venueFromLocation(raw),
    city,
    state,
    coordinates,
    coordinatesStatus: status,
    coordinatesManual: manual,
  };
}

// STATUS is the calendar's own answer and wins when it has one. The title check
// is our reading of a convention the calendar has nowhere else to put.
function buildSnapshotStatus(event: CalendarEvent): CalendarEventStatus {
  if (event.status) {
    return event.status;
  }

  return cancelledFromTitle(event.title) ? "cancelled" : "confirmed";
}

function buildSnapshotDateTime(
  value: Dayjs,
  explicitTimeZone: string | undefined,
  inferredTimeZone: InferredTimeZone,
  allDay: boolean,
): SamanthaDressDateTime {
  // The date the source calendar wrote, with no instant built out of it. It was
  // parsed as UTC midnight, so it is read back in UTC and nowhere else. An ICS
  // DATE value carries no TZID, so the venue's zone is always the inferred one.
  if (allDay) {
    return {
      date: value.utc().format("YYYY-MM-DD"),
      timeZone: inferredTimeZone.timeZone,
    };
  }

  if (explicitTimeZone) {
    return {
      iso: value.tz(explicitTimeZone).format(),
      timeZone: explicitTimeZone,
      timeZoneSource: "tzid",
      timeZoneAmbiguous: false,
    };
  }

  return {
    iso: value.tz(inferredTimeZone.timeZone).format(),
    timeZone: inferredTimeZone.timeZone,
    timeZoneSource: inferredTimeZone.source,
    timeZoneAmbiguous: inferredTimeZone.ambiguous,
  };
}

interface InferredTimeZone {
  timeZone: string;
  source: TimeZoneSource;
  ambiguous: boolean;
}

// Google Calendar publishes UTC instants with no TZID, so the instant is exact
// but the zone to display it in is not carried by the feed. The event's state is
// the best available signal, and falling back to the source's configured zone is
// the last resort.
function inferTimeZone(
  state: string | null,
  config: CalendarSourceConfig,
): InferredTimeZone {
  const stateTimeZone = timeZoneForState(state ?? undefined);

  if (stateTimeZone) {
    return {
      timeZone: stateTimeZone.timeZone,
      source: "state",
      ambiguous: stateTimeZone.ambiguous,
    };
  }

  // Nothing about the location parsed, so this zone rests on the calendar being
  // a New Jersey calendar and not on the event at all. Always ambiguous: an
  // event that got here is exactly the one whose offset might be baked wrong.
  return {
    timeZone: config.timeZone ?? "UTC",
    source: "default",
    ambiguous: true,
  };
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
