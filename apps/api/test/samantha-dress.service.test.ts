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
  now = NOW,
) {
  return buildSamanthaDressSnapshot({
    config: SAMANTHA_DRESS_SOURCE,
    events,
    sourceFetchedAt,
    store,
    now,
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
          timeUnknown: false,
          start: {
            iso: "2026-09-10T19:00:00-04:00",
            timeZone: "America/New_York",
            timeZoneSource: "tzid",
            timeZoneAmbiguous: false,
          },
          end: {
            iso: "2026-09-10T22:00:00-04:00",
            timeZone: "America/New_York",
            timeZoneSource: "tzid",
            timeZoneAmbiguous: false,
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
      // New Jersey has one zone, so inferring from it is as good as being told.
      timeZoneAmbiguous: false,
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

  // An all-day event is a calendar date, not a moment. Written as an instant it
  // would have to be midnight somewhere, and converting that into a Pacific
  // venue moves the event onto the previous day — so no instant is published for
  // one at all.
  describe("all-day dates", () => {
    function allDaySnapshot() {
      return buildSnapshot(
        icsEvents(
          "BEGIN:VEVENT",
          "UID:all-day",
          "SUMMARY:Festival",
          "DTSTART;VALUE=DATE:20260926",
          "DTEND;VALUE=DATE:20260927",
          `LOCATION:The Boardwalk\\, 100 Ocean Ave\\, Ship Bottom\\, NJ`,
          "END:VEVENT",
        ),
      );
    }

    it("publishes a bare date and the venue's zone", () => {
      expect(allDaySnapshot().events[0]).toMatchObject({
        allDay: true,
        // No `iso` and no ambiguity: there is no instant here to convert and so
        // nothing to get wrong.
        start: { date: "2026-09-26", timeZone: "America/New_York" },
        // Exclusive, as iCalendar DTEND is: a one-day event on the 26th ends on
        // the 27th.
        end: { date: "2026-09-27", timeZone: "America/New_York" },
      });
    });

    it("carries no instant on a date", () => {
      expect(Object.keys(allDaySnapshot().events[0]?.start ?? {})).toEqual([
        "date",
        "timeZone",
      ]);
    });

    it("publishes a one-day end when the source omits all-day DTEND", () => {
      const snapshot = buildSnapshot(
        icsEvents(
          "BEGIN:VEVENT",
          "UID:all-day-without-end",
          "SUMMARY:Festival",
          "DTSTART;VALUE=DATE:20260926",
          `LOCATION:The Boardwalk\\, 100 Ocean Ave\\, Ship Bottom\\, NJ`,
          "END:VEVENT",
        ),
      );

      expect(snapshot.events[0]?.start).toMatchObject({
        date: "2026-09-26",
        timeZone: "America/New_York",
      });
      expect(snapshot.events[0]?.end).toMatchObject({
        date: "2026-09-27",
        timeZone: "America/New_York",
      });
    });

    // The zone is what turns the day into an interval, so "is this over?" ends
    // the day where the venue does. Anchored to the calendar's own zone instead,
    // a Pacific all-day show would retire three hours early on its last day.
    it("reports the venue's zone, not the calendar's, on an out-of-state date", () => {
      const snapshot = buildSnapshot(
        icsEvents(
          "BEGIN:VEVENT",
          "UID:west-coast-festival",
          "SUMMARY:Festival",
          "DTSTART;VALUE=DATE:20260926",
          "DTEND;VALUE=DATE:20260927",
          "LOCATION:The Fillmore\\, 1805 Geary Blvd\\, San Francisco\\, CA",
          "END:VEVENT",
        ),
      );

      expect(snapshot.events[0]?.start).toEqual({
        date: "2026-09-26",
        timeZone: "America/Los_Angeles",
      });
    });

    it("keeps coordinates eligible through the venue-local event day", () => {
      const snapshot = buildSnapshot(
        icsEvents(
          "BEGIN:VEVENT",
          "UID:west-coast-festival",
          "SUMMARY:Festival",
          "DTSTART;VALUE=DATE:20260926",
          "DTEND;VALUE=DATE:20260927",
          "LOCATION:The Fillmore\\, 1805 Geary Blvd\\, San Francisco\\, CA",
          "END:VEVENT",
        ),
        createStore(),
        dayjs("2026-09-26T00:00:00Z"),
        // 8 PM Pacific on the event day. The local boundary is still seven
        // hours away, even though the raw DTEND is already in the past.
        dayjs("2026-09-27T03:00:00Z"),
      );

      expect(snapshot.events[0]?.location.coordinatesStatus).toBe("pending");
    });

    it("publishes an instant and no date on a timed event", () => {
      const snapshot = buildSnapshot([event("timed", "2026-08-05T23:00:00Z")]);

      expect(snapshot.events[0]?.start).toEqual({
        iso: "2026-08-05T19:00:00-04:00",
        timeZone: "America/New_York",
        timeZoneSource: "state",
        timeZoneAmbiguous: false,
      });
    });
  });

  // The bug the site could not work around: Puerto Rico is AST year-round, and
  // America/New_York only shares its offset while the mainland is on EDT.
  describe("territories", () => {
    const RINCON =
      "The Beach House Rincón, PR-413 Km 2.8, Rincón, 00677, Puerto Rico";

    it("resolves Puerto Rico to its own zone rather than the default branch", () => {
      // January, i.e. outside the window where EST and AST happen to agree. A
      // 6 PM AST show read as America/New_York renders 5 PM EST.
      const snapshot = buildSnapshot(
        icsEvents(
          "BEGIN:VEVENT",
          "UID:rincon",
          "SUMMARY:SOLO GIG @ The Beach House Rincón",
          "DTSTART:20260115T220000Z",
          "DTEND:20260116T010000Z",
          `LOCATION:The Beach House Rincón\\, PR-413 Km 2.8\\, Rincón\\, 00677\\, Puerto Rico`,
          "END:VEVENT",
        ),
      );

      expect(snapshot.events[0]?.start).toEqual({
        iso: "2026-01-15T18:00:00-04:00",
        timeZone: "America/Puerto_Rico",
        timeZoneSource: "state",
        // One zone, no DST: derived from the territory, but not a risky guess.
        timeZoneAmbiguous: false,
      });
    });

    it("gives a Puerto Rico event the city and state its URL needs", () => {
      const snapshot = buildSnapshot([
        event("rincon", "2026-01-15T22:00:00Z", RINCON),
      ]);

      expect(snapshot.events[0]?.location).toMatchObject({
        raw: RINCON,
        venue: "The Beach House Rincón",
        city: "Rincón",
        state: "PR",
      });
    });

    it.each([
      ["Emancipation Garden, Charlotte Amalie, VI", "America/St_Thomas"],
      ["Two Lovers Point, Tamuning, Guam", "Pacific/Guam"],
      ["Utulei Beach, Pago Pago, American Samoa", "Pacific/Pago_Pago"],
    ])("resolves %s to %s", (location, timeZone) => {
      const snapshot = buildSnapshot([
        event("territory", "2026-01-15T22:00:00Z", location),
      ]);

      expect(snapshot.events[0]?.start).toMatchObject({
        timeZone,
        timeZoneSource: "state",
      });
    });
  });

  // Replaces the 55-entry state-to-zones table the site was carrying purely to
  // answer "should I caption this time with its zone?".
  describe("timeZoneAmbiguous", () => {
    it("flags a state that spans more than one zone", () => {
      const snapshot = buildSnapshot([
        event(
          "texas",
          "2026-08-09T00:00:00Z",
          "The Continental Club, 1315 S Congress Ave, Austin, TX",
        ),
      ]);

      expect(snapshot.events[0]?.start).toMatchObject({
        timeZone: "America/Chicago",
        timeZoneSource: "state",
        timeZoneAmbiguous: true,
      });
    });

    it("does not flag a state that has only one", () => {
      const snapshot = buildSnapshot([event("nj", "2026-08-09T00:00:00Z")]);

      expect(snapshot.events[0]?.start.timeZoneAmbiguous).toBe(false);
    });

    it("flags Arizona because the Navajo Nation observes a different DST rule", () => {
      const snapshot = buildSnapshot([
        event("arizona", "2026-08-09T00:00:00Z", "Venue, Chinle, AZ"),
      ]);

      expect(snapshot.events[0]?.start).toMatchObject({
        timeZone: "America/Phoenix",
        timeZoneSource: "state",
        timeZoneAmbiguous: true,
      });
    });

    it("does not flag a zone the feed stated outright", () => {
      const snapshot = buildSnapshot(
        icsEvents(
          "BEGIN:VEVENT",
          "UID:tzid-texas",
          "SUMMARY:Austin show",
          "DTSTART;TZID=America/Chicago:20260808T190000",
          "LOCATION:The Continental Club\\, 1315 S Congress Ave\\, Austin\\, TX",
          "END:VEVENT",
        ),
      );

      expect(snapshot.events[0]?.start).toMatchObject({
        timeZoneSource: "tzid",
        timeZoneAmbiguous: false,
      });
    });

    // Nothing about the location parsed, so the zone rests on this being a New
    // Jersey calendar and not on the event. That is exactly the case where the
    // offset may already be baked wrong.
    it("flags a zone that fell through to the source's default", () => {
      const snapshot = buildSnapshot([
        event("unparseable", "2026-08-09T00:00:00Z", "TBD"),
      ]);

      expect(snapshot.events[0]?.start).toMatchObject({
        timeZoneSource: "default",
        timeZoneAmbiguous: true,
      });
    });
  });

  describe("timeUnknown", () => {
    it.each([
      [
        "Samantha Dress Collective @ Asbury Park Porchfest *TBD TIME & ADDRESS*",
        true,
      ],
      ["Summer Kickoff *TIME TBD*", true],
      ["Summer Kickoff (time to be announced)", true],
      // A bare marker with no noun attached: read as the time, which is what the
      // site did before this moved server-side.
      ["Summer Kickoff *TBD*", true],
      // Scoped to something that is not the time, so the clock stands.
      ["Summer Kickoff *ADDRESS TBD*", false],
      ["Summer Kickoff — lineup TBA", false],
      ["Sunset Set at Ship Bottom", false],
    ])("reads %s as timeUnknown %s", (title, expected) => {
      const snapshot = buildSnapshot([
        { ...event("uid", "2026-08-05T23:00:00Z"), title },
      ]);

      expect(snapshot.events[0]?.timeUnknown).toBe(expected);
    });
  });

  // The site used to word-match the title itself because the calendar sometimes
  // carries the cancellation there instead of in STATUS. Folded in here so there
  // is one answer rather than two that can disagree.
  describe("cancellations in the title", () => {
    it("reads a cancellation the calendar only put in the title", () => {
      const snapshot = buildSnapshot([
        { ...event("uid", "2026-08-05T23:00:00Z"), title: "CANCELLED - rain" },
      ]);

      expect(snapshot.events[0]?.status).toBe("cancelled");
    });

    // Whole-word, so the word that contains "cancelled" is not one.
    it("does not read an uncancellation as a cancellation", () => {
      const snapshot = buildSnapshot([
        {
          ...event("uid", "2026-08-05T23:00:00Z"),
          title: "UNCANCELLED - back on!",
        },
      ]);

      expect(snapshot.events[0]?.status).toBe("confirmed");
    });

    // STATUS is the calendar's own answer and the title is our reading of a
    // convention, so a calendar that says CONFIRMED is not overridden by a word.
    it("lets an explicit STATUS win over the title", () => {
      const snapshot = buildSnapshot(
        icsEvents(
          "BEGIN:VEVENT",
          "UID:confirmed-event",
          "SUMMARY:Cancelled last year\\, on this year",
          "DTSTART:20260910T230000Z",
          "STATUS:CONFIRMED",
          "END:VEVENT",
        ),
      );

      expect(snapshot.events[0]?.status).toBe("confirmed");
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

  // Ordering now reads the same day boundary the document publishes, so an
  // all-day event at a Pacific venue sorts by its own midnight rather than the
  // calendar's — three hours later, and after a Jersey show that same evening.
  it("orders an all-day date by its own venue's midnight", () => {
    const snapshot = buildSnapshot(
      icsEvents(
        "BEGIN:VEVENT",
        "UID:west-coast-all-day",
        "SUMMARY:Festival",
        "DTSTART;VALUE=DATE:20260926",
        "DTEND;VALUE=DATE:20260927",
        "LOCATION:The Fillmore\\, 1805 Geary Blvd\\, San Francisco\\, CA",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:new-jersey-evening",
        "SUMMARY:Evening show",
        // 21:00 on Sep 25 in New Jersey, i.e. after midnight on the 26th in NJ
        // but still before midnight on the 26th in California.
        "DTSTART:20260926T010000Z",
        "DTEND:20260926T030000Z",
        "LOCATION:The Stone Pony\\, 913 Ocean Ave\\, Asbury Park\\, NJ",
        "END:VEVENT",
      ),
    );

    expect(snapshot.events.map((jsonEvent) => jsonEvent.uid)).toEqual([
      "new-jersey-evening",
      "west-coast-all-day",
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
