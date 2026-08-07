import { describe, expect, it } from "vitest";

import dayjs from "../src/calendar/calendar.dates.js";
import { extractEventsFromIcs } from "../src/calendar/calendar.service.js";
import type {
  CalendarEvent,
  IcsCalendarSourceConfig,
} from "../src/calendar/calendar.types.js";
import { SAMANTHA_DRESS_SOURCE } from "../src/calendar/config/samantha-dress.js";
import {
  buildCoordinateRecord,
  createCoordinateStore,
  type CoordinateStore,
} from "../src/geocode/geocode.store.js";
import { buildSamanthaDressSnapshot } from "../src/samantha-dress/samantha-dress.service.js";

const NOW = dayjs("2026-08-03T12:00:00Z");
const SHIP_BOTTOM = "The Boardwalk, 100 Ocean Ave, Ship Bottom, NJ";

function createStore(): CoordinateStore {
  return createCoordinateStore();
}

function buildSnapshot(
  events: readonly CalendarEvent[],
  store: CoordinateStore = createStore(),
  sourceFetchedAt = dayjs("2026-08-03T11:59:58Z"),
) {
  return buildSamanthaDressSnapshot({
    config: SAMANTHA_DRESS_SOURCE,
    events,
    sourceFetchedAt,
    store,
    now: NOW,
  });
}

function icsEvents(...lines: string[]): CalendarEvent[] {
  return extractEventsFromIcs(
    ["BEGIN:VCALENDAR", ...lines, "END:VCALENDAR"].join("\r\n"),
    SAMANTHA_DRESS_SOURCE as IcsCalendarSourceConfig,
  );
}

describe("Samantha Dress snapshot", () => {
  it("publishes the documented event shape", () => {
    const store = createStore();

    store.set(
      "100 Ocean Ave, Ship Bottom, NJ",
      buildCoordinateRecord({
        status: "resolved",
        coordinates: { lat: 39.6423, lon: -74.1815 },
        attemptedAt: "2026-08-02T21:14:58.000Z",
      }),
    );

    const snapshot = buildSnapshot(
      icsEvents(
        "BEGIN:VEVENT",
        "UID:abc-123@samanthadress.com",
        "SUMMARY:Sunset Set at Ship Bottom",
        "DESCRIPTION:Free show\\, all ages.",
        "DTSTART;TZID=America/New_York:20260910T190000",
        "DTEND;TZID=America/New_York:20260910T220000",
        `LOCATION:The Boardwalk\\, 100 Ocean Ave\\, Ship Bottom\\, NJ`,
        "STATUS:CONFIRMED",
        "END:VEVENT",
      ),
      store,
    );

    expect(snapshot).toEqual({
      generatedAt: "2026-08-03T12:00:00.000Z",
      sourceFetchedAt: "2026-08-03T11:59:58.000Z",
      events: [
        {
          uid: "abc-123@samanthadress.com",
          title: "Sunset Set at Ship Bottom",
          description: "Free show, all ages.",
          status: "confirmed",
          allDay: false,
          start: {
            iso: "2026-09-10T19:00:00-04:00",
            timeZone: "America/New_York",
            timeZoneSource: "tzid",
          },
          end: {
            iso: "2026-09-10T22:00:00-04:00",
            timeZone: "America/New_York",
            timeZoneSource: "tzid",
          },
          location: {
            raw: SHIP_BOTTOM,
            venue: "The Boardwalk",
            city: "Ship Bottom",
            state: "NJ",
            coordinates: { lat: 39.6423, lon: -74.1815 },
            coordinatesStatus: "resolved",
          },
        },
      ],
    });
  });

  // Google Calendar publishes UTC instants with no TZID, so the display zone is
  // inferred and has to be labelled as inferred.
  it("labels a zone inferred from the state rather than passing it off as certain", () => {
    const snapshot = buildSnapshot(
      icsEvents(
        "BEGIN:VEVENT",
        "UID:utc-event",
        "SUMMARY:Sunset Set",
        "DTSTART:20260910T230000Z",
        "DTEND:20260911T020000Z",
        `LOCATION:The Boardwalk\\, 100 Ocean Ave\\, Ship Bottom\\, NJ`,
        "END:VEVENT",
      ),
    );

    expect(snapshot.events[0]?.start).toEqual({
      iso: "2026-09-10T19:00:00-04:00",
      timeZone: "America/New_York",
      timeZoneSource: "state",
    });
  });

  it("falls back to the source's configured zone when no state can be parsed", () => {
    const snapshot = buildSnapshot(
      icsEvents(
        "BEGIN:VEVENT",
        "UID:no-state",
        "SUMMARY:Private booking",
        "DTSTART:20260910T230000Z",
        "LOCATION:TBD",
        "END:VEVENT",
      ),
    );

    expect(snapshot.events[0]?.start.timeZoneSource).toBe("default");
    expect(snapshot.events[0]?.start.timeZone).toBe("America/New_York");
  });

  // Rendering a date-only value in a local zone would move it onto the previous
  // evening.
  it("keeps an all-day event on its own date", () => {
    const snapshot = buildSnapshot(
      icsEvents(
        "BEGIN:VEVENT",
        "UID:all-day",
        "SUMMARY:Festival",
        "DTSTART;VALUE=DATE:20260910",
        "DTEND;VALUE=DATE:20260911",
        `LOCATION:The Boardwalk\\, 100 Ocean Ave\\, Ship Bottom\\, NJ`,
        "END:VEVENT",
      ),
    );

    expect(snapshot.events[0]).toMatchObject({
      allDay: true,
      start: {
        iso: "2026-09-10T00:00:00Z",
        timeZone: "UTC",
        timeZoneSource: "default",
      },
    });
  });

  it("carries cancellations through instead of filtering them out", () => {
    const snapshot = buildSnapshot(
      icsEvents(
        "BEGIN:VEVENT",
        "UID:cancelled-event",
        "SUMMARY:Sunset Set",
        "DTSTART:20260910T230000Z",
        `LOCATION:The Boardwalk\\, 100 Ocean Ave\\, Ship Bottom\\, NJ`,
        "STATUS:CANCELLED",
        "END:VEVENT",
      ),
    );

    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.status).toBe("cancelled");
  });

  it("returns past and upcoming events sorted ascending by start", () => {
    const snapshot = buildSnapshot([
      event("later", "2026-09-01T23:00:00Z"),
      event("past", "2026-07-01T23:00:00Z"),
      event("soon", "2026-08-05T23:00:00Z"),
    ]);

    expect(snapshot.events.map((jsonEvent) => jsonEvent.uid)).toEqual([
      "past",
      "soon",
      "later",
    ]);
  });

  // An all-day date is floating and parses as UTC midnight, which is 20:00 the
  // previous evening in New Jersey — so ordering purely by instant would file a
  // Sep 10 festival ahead of a Sep 9 evening show.
  it("keeps an all-day event inside its own day, not the previous evening", () => {
    const snapshot = buildSnapshot(
      icsEvents(
        "BEGIN:VEVENT",
        "UID:all-day-sep-10",
        "SUMMARY:Festival",
        "DTSTART;VALUE=DATE:20260910",
        "DTEND;VALUE=DATE:20260911",
        `LOCATION:The Boardwalk\\, 100 Ocean Ave\\, Ship Bottom\\, NJ`,
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:evening-sep-9",
        "SUMMARY:Evening show",
        // 21:00 on Sep 9 in New Jersey, i.e. after UTC midnight on Sep 10.
        "DTSTART:20260910T010000Z",
        "DTEND:20260910T030000Z",
        "LOCATION:The Stone Pony\\, 913 Ocean Ave\\, Asbury Park\\, NJ",
        "END:VEVENT",
      ),
    );

    expect(snapshot.events.map((jsonEvent) => jsonEvent.uid)).toEqual([
      "evening-sep-9",
      "all-day-sep-10",
    ]);
  });

  // Sorting on the rendered `iso` compares wall-clock strings carrying
  // different offsets. The California show starts an hour after the New Jersey
  // one but reads "20:00" against "22:00", so a string sort puts it first.
  it("sorts across time zones by the instant, not the rendered wall clock", () => {
    const snapshot = buildSnapshot(
      icsEvents(
        "BEGIN:VEVENT",
        "UID:california",
        "SUMMARY:Later show, earlier clock",
        "DTSTART:20260807T030000Z",
        "DTEND:20260807T050000Z",
        "LOCATION:The Fillmore\\, 1805 Geary Blvd\\, San Francisco\\, CA",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:new-jersey",
        "SUMMARY:Earlier show, later clock",
        "DTSTART:20260807T020000Z",
        "DTEND:20260807T040000Z",
        "LOCATION:The Stone Pony\\, 913 Ocean Ave\\, Asbury Park\\, NJ",
        "END:VEVENT",
      ),
    );

    expect(snapshot.events.map((jsonEvent) => jsonEvent.uid)).toEqual([
      "new-jersey",
      "california",
    ]);
    // Guards the premise: if these ever render in the same zone the test stops
    // proving anything.
    expect(snapshot.events[0]?.start.iso).toContain("-04:00");
    expect(snapshot.events[1]?.start.iso).toContain("-07:00");
  });

  describe("coordinatesStatus", () => {
    it("reports pending for an upcoming address the job has not reached", () => {
      const snapshot = buildSnapshot([event("soon", "2026-08-05T23:00:00Z")]);

      expect(snapshot.events[0]?.location).toMatchObject({
        coordinates: null,
        coordinatesStatus: "pending",
      });
    });

    // Past events are deliberately never geocoded.
    it("reports skipped_past for an address only past events use", () => {
      const snapshot = buildSnapshot([event("past", "2026-07-01T23:00:00Z")]);

      expect(snapshot.events[0]?.location.coordinatesStatus).toBe(
        "skipped_past",
      );
    });

    // A past event still gets its pin when the venue was resolved for an
    // upcoming date.
    it("reports resolved for a past event at an already-resolved address", () => {
      const store = createStore();

      store.set(
        "100 Ocean Ave, Ship Bottom, NJ",
        buildCoordinateRecord({
          status: "resolved",
          coordinates: { lat: 39.6423, lon: -74.1815 },
          attemptedAt: "2026-08-02T21:14:58.000Z",
        }),
      );

      const snapshot = buildSnapshot(
        [event("past", "2026-07-01T23:00:00Z")],
        store,
      );

      expect(snapshot.events[0]?.location).toMatchObject({
        coordinates: { lat: 39.6423, lon: -74.1815 },
        coordinatesStatus: "resolved",
      });
    });

    it("reports rejected without inventing coordinates", () => {
      const store = createStore();

      store.set(
        "100 Ocean Ave, Ship Bottom, NJ",
        buildCoordinateRecord({
          status: "rejected",
          attemptedAt: "2026-08-02T21:14:58.000Z",
          reason: "result state ny does not match expected nj",
        }),
      );

      const snapshot = buildSnapshot(
        [event("soon", "2026-08-05T23:00:00Z")],
        store,
      );

      expect(snapshot.events[0]?.location).toMatchObject({
        coordinates: null,
        coordinatesStatus: "rejected",
      });
    });

    it("reports unresolvable for an event with no location", () => {
      const snapshot = buildSnapshot([
        {
          uid: "no-location",
          title: "Private booking",
          start: dayjs("2026-08-05T23:00:00Z"),
          end: dayjs("2026-08-06T02:00:00Z"),
        },
      ]);

      expect(snapshot.events[0]?.location).toEqual({
        raw: null,
        venue: null,
        city: null,
        state: null,
        coordinates: null,
        coordinatesStatus: "unresolvable",
      });
    });
  });

  describe("provenance", () => {
    it("reports no source fetch before the first successful read", () => {
      expect(
        buildSamanthaDressSnapshot({
          config: SAMANTHA_DRESS_SOURCE,
          events: [],
          sourceFetchedAt: undefined,
          store: createStore(),
          now: NOW,
        }),
      ).toEqual({
        generatedAt: "2026-08-03T12:00:00.000Z",
        sourceFetchedAt: null,
        events: [],
      });
    });

    // An upstream outage serves last-known-good events behind a sourceFetchedAt
    // that has stopped moving, rather than blanking the site's listings.
    it("keeps serving events behind a stale source fetch timestamp", () => {
      const snapshot = buildSnapshot(
        [event("soon", "2026-08-05T23:00:00Z")],
        createStore(),
        dayjs("2026-08-01T00:00:00Z"),
      );

      expect(snapshot.sourceFetchedAt).toBe("2026-08-01T00:00:00.000Z");
      expect(snapshot.events).toHaveLength(1);
    });
  });

  describe("location fields", () => {
    it.each([
      [SHIP_BOTTOM, "The Boardwalk", "Ship Bottom", "NJ"],
      [
        "The Stone Pony, Asbury Park, NJ",
        "The Stone Pony",
        "Asbury Park",
        "NJ",
      ],
      ["123 Main St, Freehold, NJ 07728", null, "Freehold", "NJ"],
      ["Ship Bottom, NJ", null, "Ship Bottom", "NJ"],
      ["TBD", null, null, null],
    ])("splits %s into venue, city and state", (raw, venue, city, state) => {
      const snapshot = buildSnapshot([
        event("uid", "2026-08-05T23:00:00Z", raw),
      ]);

      expect(snapshot.events[0]?.location).toMatchObject({
        // Never normalized: the site hands this to map providers for directions.
        raw,
        venue,
        city,
        state,
      });
    });
  });
});

function event(
  uid: string,
  start: string,
  location = SHIP_BOTTOM,
): CalendarEvent {
  return {
    uid,
    title: `Show ${uid}`,
    start: dayjs(start),
    end: dayjs(start).add(3, "hour"),
    location,
    address: location,
  };
}
