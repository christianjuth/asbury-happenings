import { normalizeGeocodeQuery } from "../calendar/address.utils.js";
import dayjs, { type Dayjs } from "../calendar/calendar.dates.js";
import type {
  CalendarEvent,
  CalendarTimeSource,
} from "../calendar/calendar.types.js";
import {
  buildSnapshotEvents,
  readSnapshotOptions,
  type SamanthaDressDateTime,
  type SamanthaDressSnapshotOptions,
} from "./samantha-dress.service.js";
import {
  cancelledFromTitle,
  timeUnknownFromTitle,
} from "./samantha-dress.title.js";

// What the source said before anything was resolved, paired with what the feed
// published for it. The published document deliberately carries only conclusions
// — an offset, a zone, a city — and once a zone is baked into an offset the
// consumer cannot tell a stated zone from a guessed one, or check the guess. This
// is the view that makes the guesses inspectable from outside the service.
interface SamanthaDressDebugDateTime {
  // The instant the source pinned, in UTC. For a floating or all-day value there
  // was no instant to pin and this is the one parsing produced.
  sourceInstant: string;
  // The clock a human reading the source calendar would see, before any zone was
  // applied to it.
  sourceWallClock: string;
  // How the source expressed the time. `floating` is the one to watch: the
  // source gave a wall clock and no zone, so `resolved.iso` carries an offset
  // that came from this service and not from the calendar.
  sourceTimeSource: CalendarTimeSource | null;
  // The TZID the source carried, when it carried one.
  sourceTimeZone: string | null;
  // Which branch of the zone resolver produced `resolved`.
  resolver: "tzid" | "state" | "default" | "all-day";
  resolved: SamanthaDressDateTime;
}

// The two signals read out of the title rather than out of a calendar field.
// `cancelled` is what folds into the published `status` when the calendar had no
// STATUS of its own, and this is where that fold stays visible.
interface SamanthaDressTitleSignals {
  timeUnknown: boolean;
  cancelled: boolean;
}

interface SamanthaDressDebugEvent {
  uid: string | null;
  title: string;
  allDay: boolean;
  start: SamanthaDressDebugDateTime;
  end: SamanthaDressDebugDateTime;
  location: {
    raw: string | null;
    // The key the coordinate store is read by, i.e. `raw` with the venue name
    // removed. An address that never resolves is usually visible here first.
    geocodeQuery: string | null;
    venue: string | null;
    city: string | null;
    state: string | null;
    coordinatesStatus: string;
  };
  titleSignals: SamanthaDressTitleSignals;
}

interface SamanthaDressDebugSnapshot {
  generatedAt: string;
  sourceFetchedAt: string | null;
  // The zone every event falls back to when its location parses to no state.
  defaultTimeZone: string;
  events: SamanthaDressDebugEvent[];
}

export function getSamanthaDressDebugSnapshot(
  now = dayjs(),
): SamanthaDressDebugSnapshot {
  return buildSamanthaDressDebugSnapshot(readSnapshotOptions(now));
}

export function buildSamanthaDressDebugSnapshot(
  options: SamanthaDressSnapshotOptions,
): SamanthaDressDebugSnapshot {
  return {
    generatedAt: options.now.toISOString(),
    sourceFetchedAt: options.sourceFetchedAt?.toISOString() ?? null,
    defaultTimeZone: options.config.timeZone ?? "UTC",
    events: buildSnapshotEvents(options).map(({ source, published }) => ({
      uid: published.uid,
      title: published.title,
      allDay: published.allDay,
      start: buildDebugDateTime({
        value: source.start,
        sourceTimeZone: source.startTimeZone,
        sourceTimeSource: source.startTimeSource,
        resolved: published.start,
        defaultTimeZone: options.config.timeZone ?? "UTC",
      }),
      end: buildDebugDateTime({
        value: source.end,
        sourceTimeZone: source.endTimeZone,
        sourceTimeSource: source.endTimeSource,
        resolved: published.end,
        defaultTimeZone: options.config.timeZone ?? "UTC",
      }),
      location: {
        raw: published.location.raw,
        geocodeQuery: readGeocodeQuery(source),
        venue: published.location.venue,
        city: published.location.city,
        state: published.location.state,
        coordinatesStatus: published.location.coordinatesStatus,
      },
      titleSignals: {
        timeUnknown: timeUnknownFromTitle(source.title),
        cancelled: cancelledFromTitle(source.title),
      },
    })),
  };
}

function buildDebugDateTime(options: {
  value: Dayjs;
  sourceTimeZone: string | undefined;
  sourceTimeSource: CalendarTimeSource | undefined;
  resolved: SamanthaDressDateTime;
  defaultTimeZone: string;
}): SamanthaDressDebugDateTime {
  const { value, sourceTimeZone, sourceTimeSource, resolved } = options;

  return {
    sourceInstant: value.toISOString(),
    // The digits the source calendar carried, recovered by reading the instant
    // back in the zone it was parsed against: its own TZID when it had one, the
    // source's configured zone when it was floating (that zone is what produced
    // the instant), and UTC otherwise. Not `resolved.timeZone`, which for a
    // floating value in another state is a zone the source never saw.
    sourceWallClock: value
      .tz(
        sourceTimeZone ??
          (sourceTimeSource === "floating" ? options.defaultTimeZone : "UTC"),
      )
      .format("YYYY-MM-DDTHH:mm:ss"),
    sourceTimeSource: sourceTimeSource ?? null,
    sourceTimeZone: sourceTimeZone ?? null,
    // A published date went down no zone-resolver branch at all, which the
    // shape of `resolved` already says.
    resolver: "date" in resolved ? "all-day" : resolved.timeZoneSource,
    resolved,
  };
}

function readGeocodeQuery(event: CalendarEvent): string | null {
  const raw = event.location ?? event.address;

  return raw ? normalizeGeocodeQuery(raw) : null;
}
