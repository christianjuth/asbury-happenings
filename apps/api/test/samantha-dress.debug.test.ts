import { describe, expect, it } from "vitest";

import dayjs from "../src/calendar/calendar.dates.js";
import { extractEventsFromIcs } from "../src/calendar/calendar.service.js";
import type { IcsCalendarSourceConfig } from "../src/calendar/calendar.types.js";
import { SAMANTHA_DRESS_SOURCE } from "../src/calendar/config/samantha-dress.js";
import { createCoordinateStore } from "../src/geocode/geocode.store.js";
import { buildSamanthaDressDebugSnapshot } from "../src/samantha-dress/samantha-dress.debug.js";

const NOW = dayjs("2026-08-03T12:00:00Z");

function buildDebug(...lines: string[]) {
  return buildSamanthaDressDebugSnapshot({
    config: SAMANTHA_DRESS_SOURCE,
    events: extractEventsFromIcs(
      ["BEGIN:VCALENDAR", ...lines, "END:VCALENDAR"].join("\r\n"),
      SAMANTHA_DRESS_SOURCE as IcsCalendarSourceConfig,
    ),
    sourceFetchedAt: dayjs("2026-08-03T11:59:58Z"),
    store: createCoordinateStore(),
    now: NOW,
  });
}

describe("Samantha Dress debug snapshot", () => {
  it("reports the source wall clock and the branch that resolved it", () => {
    const snapshot = buildDebug(
      "BEGIN:VEVENT",
      "UID:utc-event",
      "SUMMARY:Sunset Set",
      "DTSTART:20260910T230000Z",
      "DTEND:20260911T020000Z",
      "LOCATION:The Boardwalk\\, 100 Ocean Ave\\, Ship Bottom\\, NJ",
      "END:VEVENT",
    );

    expect(snapshot.events[0]?.start).toEqual({
      sourceInstant: "2026-09-10T23:00:00.000Z",
      sourceWallClock: "2026-09-10T23:00:00",
      sourceTimeSource: "utc",
      sourceTimeZone: null,
      resolver: "state",
      resolved: {
        iso: "2026-09-10T19:00:00-04:00",
        timeZone: "America/New_York",
        timeZoneSource: "state",
        timeZoneAmbiguous: false,
      },
    });
  });

  // The failure mode the published document cannot express: the source gave a
  // wall clock and no zone, so the offset in `resolved.iso` came from this
  // service. Reporting the clock in the resolved zone would hide it by showing
  // the digits the source never had.
  it("reports a floating time as floating, in the zone that was assumed for it", () => {
    const snapshot = buildDebug(
      "BEGIN:VEVENT",
      "UID:floating-event",
      "SUMMARY:Later show",
      "DTSTART:20260910T190000",
      "DTEND:20260910T220000",
      "LOCATION:The Fillmore\\, 1805 Geary Blvd\\, San Francisco\\, CA",
      "END:VEVENT",
    );

    expect(snapshot.events[0]?.start).toMatchObject({
      sourceTimeSource: "floating",
      sourceTimeZone: null,
      // 19:00 read against the source's own zone, which is what produced the
      // instant — not the 16:00 it renders as in California.
      sourceWallClock: "2026-09-10T19:00:00",
      resolver: "state",
    });
    expect(snapshot.events[0]?.start.resolved.iso).toBe(
      "2026-09-10T16:00:00-07:00",
    );
    expect(snapshot.defaultTimeZone).toBe("America/New_York");
  });

  it("reports an explicit TZID as the zone the feed stated", () => {
    const snapshot = buildDebug(
      "BEGIN:VEVENT",
      "UID:tzid-event",
      "SUMMARY:Sunset Set",
      "DTSTART;TZID=America/New_York:20260910T190000",
      "LOCATION:The Boardwalk\\, 100 Ocean Ave\\, Ship Bottom\\, NJ",
      "END:VEVENT",
    );

    expect(snapshot.events[0]?.start).toMatchObject({
      sourceTimeSource: "tzid",
      sourceTimeZone: "America/New_York",
      sourceWallClock: "2026-09-10T19:00:00",
      resolver: "tzid",
    });
  });

  it("reports an all-day value as date-only rather than as a zone decision", () => {
    const snapshot = buildDebug(
      "BEGIN:VEVENT",
      "UID:all-day",
      "SUMMARY:Festival",
      "DTSTART;VALUE=DATE:20260926",
      "DTEND;VALUE=DATE:20260927",
      "LOCATION:The Boardwalk\\, 100 Ocean Ave\\, Ship Bottom\\, NJ",
      "END:VEVENT",
    );

    expect(snapshot.events[0]?.start).toMatchObject({
      sourceTimeSource: "date",
      sourceWallClock: "2026-09-26T00:00:00",
      resolver: "all-day",
      resolved: { date: "2026-09-26", timeZone: "America/New_York" },
    });
  });

  // The address as the coordinate store is keyed by, which is where an address
  // that never resolves usually shows itself.
  it("echoes the geocode query alongside the raw location", () => {
    const snapshot = buildDebug(
      "BEGIN:VEVENT",
      "UID:located",
      "SUMMARY:Sunset Set",
      "DTSTART:20260910T230000Z",
      "LOCATION:The Boardwalk\\, 100 Ocean Ave\\, Ship Bottom\\, NJ",
      "END:VEVENT",
    );

    expect(snapshot.events[0]?.location).toEqual({
      raw: "The Boardwalk, 100 Ocean Ave, Ship Bottom, NJ",
      geocodeQuery: "100 Ocean Ave, Ship Bottom, NJ",
      venue: "The Boardwalk",
      city: "Ship Bottom",
      state: "NJ",
      coordinatesStatus: "pending",
    });
  });

  it("shows the title signals separately from the fields they fold into", () => {
    const snapshot = buildDebug(
      "BEGIN:VEVENT",
      "UID:porchfest",
      "SUMMARY:Porchfest *TBD TIME & ADDRESS*",
      "DTSTART:20260910T230000Z",
      "END:VEVENT",
    );

    expect(snapshot.events[0]?.titleSignals).toEqual({
      timeUnknown: true,
      cancelled: false,
    });
  });
});
