import { describe, expect, it } from "vitest";
import { toCalendarScheduleData } from "./calendar.adapter";
import type { CalendarEventsResponse } from "./calendar.types";

describe("toCalendarScheduleData", () => {
  it("converts UTC instants to resource-local schedule times", () => {
    const response: CalendarEventsResponse = {
      date: "2026-07-03",
      generatedAt: "2026-07-03T16:00:00.000Z",
      resources: [
        {
          id: "stone-pony",
          name: "The Stone Pony",
          timeZone: "America/New_York",
          loading: false,
          ready: true,
          subscriptionPath: "/calendar/stone-pony.ics",
        },
      ],
      events: [
        {
          id: "stone-pony:event",
          resourceId: "stone-pony",
          title: "Summer Stage",
          start: "2026-07-03T22:00:00.000Z",
          end: "2026-07-04T00:00:00.000Z",
          allDay: false,
        },
      ],
    };

    expect(toCalendarScheduleData(response).events[0]).toMatchObject({
      start: "2026-07-03 18:00:00",
      end: "2026-07-03 20:00:00",
      resourceId: "stone-pony",
      color: "orange",
    });
  });

  it("keeps all-day events as exclusive local date ranges", () => {
    const response: CalendarEventsResponse = {
      date: "2026-07-04",
      generatedAt: "2026-07-03T16:00:00.000Z",
      resources: [
        {
          id: "city",
          name: "City of Asbury Park",
          timeZone: "America/New_York",
          loading: false,
          ready: true,
          subscriptionPath: "/calendar/city.ics",
        },
      ],
      events: [
        {
          id: "city:event",
          resourceId: "city",
          title: "Holiday",
          start: "2026-07-04",
          end: "2026-07-05",
          allDay: true,
        },
      ],
    };

    expect(toCalendarScheduleData(response).events[0]).toMatchObject({
      start: "2026-07-04 00:00:00",
      end: "2026-07-05 00:00:00",
    });
  });
});
