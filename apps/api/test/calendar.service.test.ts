import { describe, expect, it } from "vitest";
import { extractEventsFromHtml } from "../src/calendar/calendar.service.js";

describe("extractEventsFromHtml", () => {
  it("uses the page title as the placeholder event title", () => {
    const events = extractEventsFromHtml(
      "<html><head><title>Community Events</title></head><body></body></html>",
      "https://example.com/events"
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: "Community Events",
      url: "https://example.com/events"
    });
  });
});
