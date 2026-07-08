import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCalendarFetchState,
  extractEventsFromHtml,
  extractEventsFromIcs,
  extractEventsFromJson,
  eventsToIcs,
  filterCalendarEvents,
  fetchCalendarEvents,
  renderSourceUrl,
  renderSourceUrls,
  type CalendarSourceConfig,
  type HtmlCalendarSourceConfig,
  type IcsCalendarSourceConfig,
  type JsonCalendarSourceConfig,
} from "../src/calendar/calendar.service.js";
import { getCalendarSource } from "../src/calendar/calendar.config.js";
import dayjs from "../src/calendar/calendar.dates.js";
import {
  extractUncorkedWineInspiredEvents,
  stripHtmlFromEventLocation,
} from "../src/calendar/calendar.post-processing.js";

afterEach(() => {
  clearCalendarFetchState();
  vi.restoreAllMocks();
});

const config: HtmlCalendarSourceConfig = {
  id: "community",
  name: "Community Events",
  sourceType: "html",
  url: "https://example.com/events/{year}/{month}",
  containerSelector: "article",
  selectors: {
    title: ".event-title",
    start: {
      selector: "time.start",
      attr: "datetime",
      format: "YYYY-MM-DDTHH:mm:ss[Z]",
    },
    end: {
      selector: "time.end",
      attr: "datetime",
      format: "YYYY-MM-DDTHH:mm:ss[Z]",
    },
    description: ".description",
    location: ".location",
    url: {
      selector: "a.details",
      attr: "href",
    },
  },
};

describe("extractEventsFromHtml", () => {
  it("extracts events from configured containers and selectors", () => {
    const events = extractEventsFromHtml(
      `
        <article>
          <h2 class="event-title"> First Event </h2>
          <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          <time class="end" datetime="2026-07-04T19:30:00Z">7:30 PM</time>
          <p class="description"> Fireworks and food. </p>
          <span class="location">Town Green</span>
          <a class="details" href="/events/first">Details</a>
        </article>
        <article>
          <h2 class="event-title">Second Event</h2>
          <time class="start" datetime="2026-07-05T15:00:00Z">July 5</time>
          <time class="end" datetime="2026-07-05T16:00:00Z">4 PM</time>
          <a class="details" href="https://events.example.com/second">Details</a>
        </article>
      `,
      config,
      "https://example.com/events/2026/07",
    );

    expect(events).toHaveLength(2);
    expect(dayjs.isDayjs(events[0]?.start)).toBe(true);
    expect(dayjs.isDayjs(events[0]?.end)).toBe(true);
    expect(events[0]).toMatchObject({
      title: "First Event",
      description: "Fireworks and food.",
      location: "Town Green",
      url: "https://example.com/events/first",
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-04T18:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-04T19:30:00.000Z");
    expect(events[1]?.url).toBe("https://events.example.com/second");
  });

  it("skips containers missing required title or start date", () => {
    const events = extractEventsFromHtml(
      `
        <article>
          <h2 class="event-title">No Date</h2>
        </article>
        <article>
          <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
        </article>
      `,
      config,
      "https://example.com/events/2026/07",
    );

    expect(events).toEqual([]);
  });

  it("skips containers with invalid start dates", () => {
    const events = extractEventsFromHtml(
      `
        <article>
          <h2 class="event-title">Bad Date</h2>
          <time class="start" datetime="not-a-date">Nope</time>
        </article>
      `,
      config,
      "https://example.com/events/2026/07",
    );

    expect(events).toEqual([]);
  });

  it("uses default duration when no end selector is configured", () => {
    const noEndConfig: CalendarSourceConfig = {
      ...config,
      selectors: {
        title: ".event-title",
        start: {
          selector: "time.start",
          attr: "datetime",
        },
      },
      defaultDurationMinutes: 45,
    };

    const events = extractEventsFromHtml(
      `
        <article>
          <h2 class="event-title">Short Event</h2>
          <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
        </article>
      `,
      noEndConfig,
      "https://example.com/events/2026/07",
    );

    expect(events[0]?.end.toISOString()).toBe("2026-07-04T18:45:00.000Z");
  });

  it("parses compact month and day text with current year", () => {
    const compactDateConfig: CalendarSourceConfig = {
      ...config,
      selectors: {
        title: ".event-title",
        start: ".event-date",
      },
      defaultDurationMinutes: 60,
    };

    const events = extractEventsFromHtml(
      `
        <article>
          <h2 class="event-title">Split Date Event</h2>
          <div class="event-date">
            <span>Jul</span>
            <span>02</span>
          </div>
        </article>
      `,
      compactDateConfig,
      "https://example.com/events/2026/07",
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.start.toISOString()).toBe("2026-07-02T00:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-02T01:00:00.000Z");
  });

  it("combines separate date and time selectors from the same details block", () => {
    const detailsConfig: CalendarSourceConfig = {
      ...config,
      selectors: {
        title: ".event-list__title",
        startDate: {
          selector: ".event-list__details",
          pattern: /[A-Za-z]{3},\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
          format: "M/D/YYYY",
        },
        startTime: {
          selector: ".event-list__details",
          pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)\s*-/i,
          format: ["h:mma", "h:mm a"],
        },
        endTime: {
          selector: ".event-list__details",
          pattern: /-\s*([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
          format: ["h:mma", "h:mm a"],
        },
      },
    };

    const events = extractEventsFromHtml(
      `
        <article class="event-list">
          <h2 class="event-list__title">Author Talk</h2>
          <div class="event-list__details">
            Mon, 7/6/2026
            7:00pm - 8:30pm
          </div>
        </article>
      `,
      detailsConfig,
      "https://example.com/events",
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.start.toISOString()).toBe("2026-07-06T19:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-06T20:30:00.000Z");
  });

  it("parses configured local timezone before converting to UTC", () => {
    const easternConfig: CalendarSourceConfig = {
      ...config,
      timeZone: "America/New_York",
      selectors: {
        title: ".event-list__title",
        startDate: {
          selector: ".event-list__details",
          pattern: /[A-Za-z]{3},\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
          format: "M/D/YYYY",
        },
        startTime: {
          selector: ".event-list__details",
          pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)\s*-/i,
          format: ["h:mma", "h:mm a"],
        },
        endTime: {
          selector: ".event-list__details",
          pattern: /-\s*([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
          format: ["h:mma", "h:mm a"],
        },
      },
    };

    const events = extractEventsFromHtml(
      `
        <article class="event-list">
          <h2 class="event-list__title">Author Talk</h2>
          <div class="event-list__details">
            Mon, 7/6/2026
            7:00pm - 8:30pm
          </div>
        </article>
      `,
      easternConfig,
      "https://example.com/events",
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.start.toISOString()).toBe("2026-07-06T23:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-07T00:30:00.000Z");
  });

  it("extracts description from the event container after removing metadata", () => {
    const descriptionConfig: CalendarSourceConfig = {
      ...config,
      selectors: {
        title: ".event-list__title",
        startDate: {
          selector: ".event-list__details",
          pattern: /[A-Za-z]{3},\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
          format: "M/D/YYYY",
        },
        startTime: {
          selector: ".event-list__details",
          pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)\s*-/i,
          format: ["h:mma", "h:mm a"],
        },
        description: {
          selector: ":self",
          remove: [
            ".event-list__title",
            ".event-list__details",
            ".event-list__links",
          ],
        },
        url: {
          selector: "a.event-list__links--event",
          attr: "href",
        },
      },
    };

    const events = extractEventsFromHtml(
      `
        <article class="event-list">
          <h2 class="event-list__title">Author Talk</h2>
          <div class="event-list__details">
            Mon, 7/6/2026
            7:00pm - 8:30pm
          </div>
          <p>Meet the author for a reading and conversation.</p>
          <div class="event-list__links">
            <a class="event-list__links--event" href="/events/author-talk">View Event</a>
          </div>
        </article>
      `,
      descriptionConfig,
      "https://example.com/events",
    );

    expect(events[0]?.description).toBe(
      "Meet the author for a reading and conversation.",
    );
    expect(events[0]?.description).not.toContain("Author Talk");
    expect(events[0]?.description).not.toContain("7:00pm");
    expect(events[0]?.description).not.toContain("View Event");
  });

  it("extracts address and uses it as ICS location when no location selector is configured", () => {
    const addressConfig: CalendarSourceConfig = {
      ...config,
      selectors: {
        title: ".event-list__title",
        startDate: {
          selector: ".event-list__details",
          pattern: /[A-Za-z]{3},\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
          format: "M/D/YYYY",
        },
        startTime: {
          selector: ".event-list__details",
          pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)\s*-/i,
          format: ["h:mma", "h:mm a"],
        },
        address: {
          selector: ".event-list__details",
          pattern: /Place:\s*(.+)$/i,
        },
      },
    };

    const events = extractEventsFromHtml(
      `
        <article class="event-list">
          <h2 class="event-list__title">Author Talk</h2>
          <div class="event-list__details">
            Mon, 7/6/2026
            7:00pm - 8:30pm
            Place: Asbury Book Cooperative 644A Cookman Ave Asbury Park, NJ 07712
          </div>
        </article>
      `,
      addressConfig,
      "https://example.com/events",
    );

    expect(events[0]?.address).toBe(
      "Asbury Book Cooperative 644A Cookman Ave Asbury Park, NJ 07712",
    );
    expect(events[0]?.location).toBe(
      "Asbury Book Cooperative 644A Cookman Ave Asbury Park, NJ 07712",
    );
  });

  it("uses default address when no address is found", () => {
    const addressConfig: CalendarSourceConfig = {
      ...config,
      defaultAddress:
        "Asbury Book Cooperative, 644A Cookman Ave, Asbury Park, NJ 07712",
      selectors: {
        title: ".event-list__title",
        startDate: {
          selector: ".event-list__details",
          pattern: /[A-Za-z]{3},\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
          format: "M/D/YYYY",
        },
        startTime: {
          selector: ".event-list__details",
          pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)\s*-/i,
          format: ["h:mma", "h:mm a"],
        },
        address: {
          selector: ".event-list__details",
          pattern: /Place:\s*(.+)$/i,
        },
      },
    };

    const events = extractEventsFromHtml(
      `
        <article class="event-list">
          <h2 class="event-list__title">Author Talk</h2>
          <div class="event-list__details">
            Mon, 7/6/2026
            7:00pm - 8:30pm
          </div>
        </article>
      `,
      addressConfig,
      "https://example.com/events",
    );

    expect(events[0]?.address).toBe(
      "Asbury Book Cooperative, 644A Cookman Ave, Asbury Park, NJ 07712",
    );
    expect(events[0]?.location).toBe(
      "Asbury Book Cooperative, 644A Cookman Ave, Asbury Park, NJ 07712",
    );
  });

  it("parses Tim McLoone event list cards", () => {
    const timMclooneConfig: HtmlCalendarSourceConfig = {
      id: "tim-mcloones-supper-club",
      name: "Tim McLoone's Supper Club",
      sourceType: "html",
      url: "https://timmcloonessupperclub.com/events.php",
      containerSelector: ".events_col2",
      selectors: {
        title: "h2 a",
        startDate: {
          selector: ".event_date",
          pattern: /^[A-Za-z]+,\s*(.+)$/,
          format: "MMMM D",
        },
        startTime: {
          selector: ":self",
          pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
          format: ["h:mma", "h:mm a"],
        },
        endTime: {
          selector: ":self",
          pattern: /-\s*([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
          format: ["h:mma", "h:mm a"],
        },
        description: {
          selector: ":self",
          remove: ["h2", ".event_date", "a", ".btn_events"],
        },
        url: {
          selector: "h2 a",
          attr: "href",
        },
      },
      dateFormats: ["MMMM D"],
      timeZone: "America/New_York",
      defaultAddress:
        "Tim McLoone's Supper Club, 1200 Ocean Avenue, Asbury Park, NJ 07712",
      defaultDurationMinutes: 120,
    };

    const events = extractEventsFromHtml(
      `
        <div class="events_col2">
          <div class="event_date">Thursday, July 2</div>
          <h2><a href="events.php?id=7329">Gonzo's Band of Brothers &amp; Sisters SUMMER JAM!</a></h2>
          <div class="event_subtitle"><h3>featuring Layonne Holmes &amp; Reagan Richards</h3></div>
          <div>7:00pm</div>
          <a href="events.php?id=7329"><div class="btn_events">DETAILS</div></a>
        </div>
        <div class="events_col2">
          <div class="event_date">Friday, July 3</div>
          <h2><a href="events.php?id=7430">Asbury Park Fireworks w/ Shore Thing!</a></h2>
          <div>No Cover Charge. Reservations through OpenTable. Click "Tickets" to Reserve!, 6:00pm - 10:00pm</div>
          <a href="events.php?id=7430"><div class="btn_events">DETAILS</div></a>
        </div>
        <div class="events_col2">
          <div class="event_date">Tuesday, July 7</div>
          <h2><a href="events.php?id=7441">Bob Egan's 'Piano Party'</a></h2>
          <div>NO COVER CHARGE!, 6:30pm - 8:30pm</div>
          <a href="events.php?id=7441"><div class="btn_events">DETAILS</div></a>
        </div>
        <div class="events_col2">
          <div class="event_date">Thursday, July 9</div>
          <h2><a href="events.php?id=6797">A Medium Gallery with Linda Shields</a></h2>
          <div class="event_subtitle"><h3>"THE JERSEY SHORE MEDIUM"</h3></div>
          <a href="events.php?id=6797"><div class="btn_events">DETAILS</div></a>
        </div>
      `,
      timMclooneConfig,
      "https://timmcloonessupperclub.com/events.php",
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({
      title: "Gonzo's Band of Brothers & Sisters SUMMER JAM!",
      description: "featuring Layonne Holmes & Reagan Richards 7:00pm",
      address:
        "Tim McLoone's Supper Club, 1200 Ocean Avenue, Asbury Park, NJ 07712",
      location:
        "Tim McLoone's Supper Club, 1200 Ocean Avenue, Asbury Park, NJ 07712",
      url: "https://timmcloonessupperclub.com/events.php?id=7329",
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-02T23:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-03T01:00:00.000Z");
    expect(events[1]?.title).toBe("Asbury Park Fireworks w/ Shore Thing!");
    expect(events[1]?.start.toISOString()).toBe("2026-07-03T22:00:00.000Z");
    expect(events[1]?.end.toISOString()).toBe("2026-07-04T02:00:00.000Z");
    expect(events[2]?.title).toBe("Bob Egan's 'Piano Party'");
    expect(events[2]?.start.toISOString()).toBe("2026-07-07T22:30:00.000Z");
    expect(events[2]?.end.toISOString()).toBe("2026-07-08T00:30:00.000Z");
    expect(events[3]?.title).toBe(
      "A Medium Gallery with Linda Shields (MISSING TIME)",
    );
    expect(events[3]?.allDay).toBe(true);
    expect(events[3]?.start.toISOString()).toBe("2026-07-09T04:00:00.000Z");
    expect(events[3]?.end.toISOString()).toBe("2026-07-10T04:00:00.000Z");
  });

  it("parses AP Rooftop event list cards", () => {
    const apRooftopConfig = getCalendarSource("ap-rooftop");

    if (!apRooftopConfig) {
      throw new Error("Missing AP Rooftop calendar config");
    }

    const events = extractEventsFromHtml(
      `
        <div id="main-content-sub">
          <div style="width: 100%; position: relative; margin-left: auto; margin-right: auto;">
            <div class="events_col1_image events_col1_image_reg"></div>
            <div class="events_col2">
              <div class="event_date">Friday, July 3</div>
              <h2>DJ MoTalent from Mo Talent Live</h2>
              <div>Location: <strong>Arthur Pryor Bandshell - Outdoor Concert</strong>, 1200 Ocean Ave, Third Floor, Asbury Park, NJ</div>
              <div>7:00pm - 10:00pm</div>
            </div>
          </div>
          <div style="width: 100%; position: relative; margin-left: auto; margin-right: auto;">
            <div class="events_col1">
              <div>Friday</div>
              <div>10</div>
              <div>July</div>
            </div>
            <div class="events_col2">
              <h2>DJ Quikdish</h2>
              <div>Location: <strong>Arthur Pryor Bandshell - Outdoor Concert</strong>, 1200 Ocean Ave, Third Floor, Asbury Park, NJ</div>
              <div>7:00pm</div>
            </div>
          </div>
        </div>
      `,
      apRooftopConfig,
      "https://aprooftop.com/events.php",
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      title: "DJ MoTalent from Mo Talent Live",
      address: "Arthur Pryor Bandshell, 1200 Ocean Ave, Asbury Park, NJ 07712",
      location: "Arthur Pryor Bandshell, 1200 Ocean Ave, Asbury Park, NJ 07712",
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-03T23:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-04T02:00:00.000Z");
    expect(events[1]?.title).toBe("DJ Quikdish");
    expect(events[1]?.start.toISOString()).toBe("2026-07-10T23:00:00.000Z");
    expect(events[1]?.end.toISOString()).toBe("2026-07-11T02:00:00.000Z");
  });

  it("parses AP Rooftop event times with uppercase AM in descriptions", () => {
    const apRooftopConfig = getCalendarSource("ap-rooftop");

    if (!apRooftopConfig) {
      throw new Error("Missing AP Rooftop calendar config");
    }

    const events = extractEventsFromHtml(
      `
        <div id="main-content-sub">
          <div style="width: 100%; position: relative; margin-left: auto; margin-right: auto;">
            <div class="events_col1_image events_col1_image_reg" style="background-image: url(https://cdn.mcloones.com/images/calendar/7.12.26-Jetset-APR.PNG);"></div>
            <div class="events_col2">
              <div class="event_date">Sunday, July 12</div>
              <h2>JETSET ON THE MAT: BRUNCH &amp; BURN</h2>
              <div style="margin-top: 2px;">Location: <strong>Arthur Pryor Bandshell - Outdoor Concert</strong>, 1200 Ocean Ave, Third Floor, Asbury Park, NJ</div>
              <div style="margin-top: 0;"><a href="https://sweatpals.com/event/jetset-on-the-mat-brunch-burn-at-ap-rooftop/2026-07-12" target="_blank">CLICK HERE FOR MORE INFORMATION - SOLD OUT</a></div>
              <div style="margin-top: 0;">
                <p></p>AP ROOFTOP x JETSET Pilates Oakhurst:<p></p>
                Brunch &amp; Burn
                <p></p>10:00 AM Check-In<p></p>
                <p></p>10:30 AM JETSET on the Mat Class overlooking the Atlantic Ocean<p></p>
                <p></p>Check-In: 10:00 AM | Class Begins: 10:30 AM<p></p>
              </div>
              <div>SOLD OUT, 10:00am - 1:00pm</div>
            </div>
          </div>
        </div>
      `,
      apRooftopConfig,
      "https://aprooftop.com/events.php",
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("JETSET ON THE MAT: BRUNCH & BURN");
    expect(events[0]?.start.toISOString()).toBe("2026-07-12T14:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-12T17:00:00.000Z");
  });

  it("parses Iron Whale event list cards", () => {
    const ironWhaleConfig = getCalendarSource("iron-whale");

    if (!ironWhaleConfig) {
      throw new Error("Missing Iron Whale calendar config");
    }

    const events = extractEventsFromHtml(
      `
        <div id="main-content-sub" tabindex="-1">
          <h1>Events</h1>
          <div style="width: 100%; position: relative; clear: none; margin-right: 70px;">
            <div style="width: 100%; position: relative; margin-left: auto; margin-right: auto;">
              <div class="events_col1_image events_col1_image_reg" style="background-image: url(https://cdn.mcloones.com/images/calendar/7.7.26-Makers-Mark-IW.png);"></div>
              <div class="events_col2">
                <div><h3>Tuesday, July 7</h3></div>
                <div><h3>Maker's Mark Tasting Event: Wax-Dipped Souvenir Glass</h3></div>
                <div style="margin-top: 2px;">Location: <strong>Iron Whale</strong>, 1200 Ocean Avenue, Asbury Park, NJ</div>
                <div style="margin-top: 0;"><a href="https://cdn.mcloones.com/pdf/iron-whale/menus/2026/7.7.26-Makers-Mark-IW.pdf" target="_blank">CLICK HERE FOR DETAILS &amp; RESERVATIONS</a></div>
                <div style="margin-top: 0;"><p></p>Join us for an exclusive Maker's Mark Tasting experience, where you'll enjoy a guided sampling of Maker's Mark signature bourbons paired with a selection of small bites.<p></p></div>
                <div>6:00pm - 8:00pm</div>
              </div>
            </div>
          </div>
        </div>
      `,
      ironWhaleConfig,
      "https://www.ironwhalenj.com/events.php",
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: "Maker's Mark Tasting Event: Wax-Dipped Souvenir Glass",
      description:
        "Location: Iron Whale, 1200 Ocean Avenue, Asbury Park, NJ Join us for an exclusive Maker's Mark Tasting experience, where you'll enjoy a guided sampling of Maker's Mark signature bourbons paired with a selection of small bites. 6:00pm - 8:00pm",
      address: "Iron Whale, 1200 Ocean Avenue, Asbury Park, NJ 07712",
      location: "Iron Whale, 1200 Ocean Avenue, Asbury Park, NJ 07712",
      url: "https://cdn.mcloones.com/pdf/iron-whale/menus/2026/7.7.26-Makers-Mark-IW.pdf",
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-07T22:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-08T00:00:00.000Z");
  });

  it("parses R Bar Squarespace event list cards", () => {
    const rBarConfig: HtmlCalendarSourceConfig = {
      id: "r-bar",
      name: "R Bar",
      sourceType: "html",
      url: "https://www.itsrbar.com/events",
      containerSelector: "article.eventlist-event",
      selectors: {
        title: ".eventlist-title-link",
        startDate: {
          selector: "time.event-date",
          attr: "datetime",
          format: "YYYY-MM-DD",
        },
        startTime: {
          selector: ".event-time-localized-start",
          format: ["h:mm A", "h:mm a"],
        },
        endTime: {
          selector: ".event-time-localized-end",
          format: ["h:mm A", "h:mm a"],
        },
        description: ".eventlist-excerpt, .eventlist-description",
        url: {
          selector: ".eventlist-title-link",
          attr: "href",
        },
      },
      timeZone: "America/New_York",
      defaultAddress: "R Bar & Restaurant, 1114 Main St, Asbury Park, NJ 07712",
      defaultDurationMinutes: 180,
    };

    const events = extractEventsFromHtml(
      `
        <article class="eventlist-event eventlist-event--upcoming">
          <h1 class="eventlist-title">
            <a href="/events/high-standards-trio" class="eventlist-title-link">High Standards Trio</a>
          </h1>
          <ul class="eventlist-meta event-meta">
            <li class="eventlist-meta-date">
              <time class="event-date" datetime="2026-07-02">Thursday, July 2, 2026</time>
            </li>
            <li class="eventlist-meta-time">
              <span class="event-time-localized">
                <time class="event-time-localized-start" datetime="2026-07-02">6:00 PM</time>
                <time class="event-time-localized-end" datetime="2026-07-02">9:00 PM</time>
              </span>
            </li>
          </ul>
          <div class="eventlist-description"></div>
          <a href="/events/high-standards-trio" class="eventlist-button">View Event</a>
        </article>
        <article class="eventlist-event eventlist-event--upcoming">
          <h1 class="eventlist-title">
            <a href="/events/2026/6/23/ocean-avenue-swingers" class="eventlist-title-link">4th of July High Standard Stomp Off</a>
          </h1>
          <ul class="eventlist-meta event-meta">
            <li class="eventlist-meta-date">
              <time class="event-date" datetime="2026-07-04">Saturday, July 4, 2026</time>
            </li>
            <li class="eventlist-meta-time">
              <span class="event-time-localized">
                <time class="event-time-localized-start" datetime="2026-07-04">2:00 PM</time>
                <time class="event-time-localized-end" datetime="2026-07-04">5:00 PM</time>
              </span>
            </li>
          </ul>
          <div class="eventlist-excerpt">
            <p>R Bar Presents R Yard Saturdays A High Standard Stomp Off</p>
            <p>No cover</p>
          </div>
          <a href="/events/2026/6/23/ocean-avenue-swingers" class="eventlist-button">View Event</a>
        </article>
      `,
      rBarConfig,
      "https://www.itsrbar.com/events",
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      title: "High Standards Trio",
      address: "R Bar & Restaurant, 1114 Main St, Asbury Park, NJ 07712",
      location: "R Bar & Restaurant, 1114 Main St, Asbury Park, NJ 07712",
      url: "https://www.itsrbar.com/events/high-standards-trio",
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-02T22:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-03T01:00:00.000Z");
    expect(events[1]?.description).toBe(
      "R Bar Presents R Yard Saturdays A High Standard Stomp Off No cover",
    );
    expect(events[1]?.start.toISOString()).toBe("2026-07-04T18:00:00.000Z");
    expect(events[1]?.end.toISOString()).toBe("2026-07-04T21:00:00.000Z");
  });

  it("parses Smith Made event list cards with month URL context", () => {
    const brickwallConfig = getCalendarSource("asbury-brickwall");
    const lovesickConfig = getCalendarSource("asbury-lovesick");

    if (!brickwallConfig?.extractEvents || !lovesickConfig?.extractEvents) {
      throw new Error("Missing Smith Made calendar config");
    }

    const brickwallEvents = brickwallConfig.extractEvents(
      `
        <div class="results pb-lg">
          <div class="border-b last:border-0 pt-xs pb-sm">
            <div class="grid grid-cols-14">
              <div class="col-span-14 md:col-span-2">
                <div class="date">
                  <p class="type">Thursday</p>
                  <p class="type--h2 mt-[-4px]">9</p>
                </div>
              </div>
              <div class="col-span-14 md:col-span-10">
                <div class="event-info w-full">
                  <h2 class="type--h2 mb-xs mt-[-10px]">Hip Hop Happy Hour</h2>
                  <div class="event-meta flex gap-xs mb-xs type--p-2 ml-[-3px]">
                    <a href="/locations/brickwall">Brickwall</a>
                    <div>5:00  to 10:00 PM</div>
                  </div>
                  <div class="event-description mb-xs">
                    <p class="type--p-2">with Dusty Dubs</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `,
      brickwallConfig,
      {
        sourceUrl:
          "https://www.smithmade.org/events/date/2026-07/location/brickwall",
        referenceDate: dayjs("2026-07-03T00:00:00Z"),
      },
    );

    const lovesickEvents = lovesickConfig.extractEvents(
      `
        <div class="results pb-lg">
          <div class="border-b last:border-0 pt-xs pb-sm">
            <div class="grid grid-cols-14">
              <div class="col-span-14 md:col-span-2">
                <div class="date">
                  <p class="type">Sunday</p>
                  <p class="type--h2 mt-[-4px]">5</p>
                </div>
              </div>
              <div class="col-span-14 md:col-span-10">
                <div class="event-info w-full">
                  <h2 class="type--h2 mb-xs mt-[-10px]">Weekend Supervision</h2>
                  <div class="event-meta flex gap-xs mb-xs type--p-2 ml-[-3px]">
                    <a href="/locations/lovesick">Lovesick</a>
                    <div>9:00 to 1:00 AM</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `,
      lovesickConfig,
      {
        sourceUrl:
          "https://www.smithmade.org/events/date/2026-07/location/lovesick",
        referenceDate: dayjs("2026-07-03T00:00:00Z"),
      },
    );

    expect(brickwallEvents).toHaveLength(1);
    expect(brickwallEvents[0]).toMatchObject({
      title: "Hip Hop Happy Hour",
      description: "with Dusty Dubs",
      address: "Brickwall, 522 Cookman Ave, Asbury Park, NJ 07712",
      location: "Brickwall, 522 Cookman Ave, Asbury Park, NJ 07712",
      url: "https://www.smithmade.org/events/date/2026-07/location/brickwall",
    });
    expect(brickwallEvents[0]?.start.toISOString()).toBe(
      "2026-07-09T21:00:00.000Z",
    );
    expect(brickwallEvents[0]?.end.toISOString()).toBe(
      "2026-07-10T02:00:00.000Z",
    );
    expect(lovesickEvents).toHaveLength(1);
    expect(lovesickEvents[0]).toMatchObject({
      title: "Weekend Supervision",
      address: "Lovesick, 530 Cookman Ave, Asbury Park, NJ 07712",
      location: "Lovesick, 530 Cookman Ave, Asbury Park, NJ 07712",
      url: "https://www.smithmade.org/events/date/2026-07/location/lovesick",
    });
    expect(lovesickEvents[0]?.start.toISOString()).toBe(
      "2026-07-06T01:00:00.000Z",
    );
    expect(lovesickEvents[0]?.end.toISOString()).toBe(
      "2026-07-06T05:00:00.000Z",
    );
  });

  it("parses Stone Pony EventON calendar cards", () => {
    const stonePonyConfig = getCalendarSource("stone-pony");

    if (!stonePonyConfig || stonePonyConfig.sourceType !== "html") {
      throw new Error("Missing Stone Pony calendar config");
    }

    const events = extractEventsFromHtml(
      `
        <div class="eventon_list_event">
          <div class="evo_event_schema" style="display:none">
            <a itemprop="url" href="https://www.stoneponyonline.com/events/black-country-new-road/"></a>
            <span itemprop="name">Black Country, New Road</span>
            <meta itemprop="startDate" content="2026-7-5T19:00">
            <meta itemprop="endDate" content="2026-7-5T23:50">
          </div>
          <span class="evcal_desc" data-location_address="913 Ocean Avenue" data-location_name="The Stone Pony">
            <span class="evcal_desc2 evcal_event_title">Black Country, New Road</span>
            <span class="evcal_event_subtitle">Horsegirl</span>
          </span>
          <div class="eventon_desc_in" itemprop="description">
            <p><strong>Black Country, New Road</strong><br>Horsegirl</p>
            <p>There are few contemporary bands who can do musical reinvention quite as consistently.</p>
          </div>
        </div>
        <div class="eventon_list_event">
          <div class="evo_event_schema" style="display:none">
            <a itemprop="url" href="/events/silverstein-story-of-the-year/"></a>
            <span itemprop="name">Silverstein &amp; Story of the Year</span>
            <meta itemprop="startDate" content="2026-7-12T17:00">
            <meta itemprop="endDate" content="2026-7-12T22:00">
          </div>
          <span class="evcal_desc" data-location_address="913 Ocean Avenue " data-location_name="The Stone Pony Summer Stage">
            <span class="evcal_desc2 evcal_event_title">Silverstein &amp; Story of the Year</span>
            <span class="evcal_event_subtitle">on The Stone Pony Summer Stage</span>
          </span>
          <div class="eventon_desc_in" itemprop="description">
            <p><strong>Silverstein &amp; Story of the Year</strong><br>Camp Screamo Tour</p>
            <p>4:30 Inside Stone Pony Door</p>
          </div>
        </div>
      `,
      stonePonyConfig,
      "https://www.stoneponyonline.com/calendar/",
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      title: "Black Country, New Road",
      description:
        "Black Country, New Road Horsegirl There are few contemporary bands who can do musical reinvention quite as consistently.",
      location: "The Stone Pony",
      address: "913 Ocean Avenue",
      url: "https://www.stoneponyonline.com/events/black-country-new-road/",
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-05T23:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-06T03:50:00.000Z");
    expect(events[1]).toMatchObject({
      title: "Silverstein & Story of the Year",
      location: "The Stone Pony Summer Stage",
      address: "913 Ocean Avenue",
      url: "https://www.stoneponyonline.com/events/silverstein-story-of-the-year/",
    });
    expect(events[1]?.start.toISOString()).toBe("2026-07-12T21:00:00.000Z");
    expect(events[1]?.end.toISOString()).toBe("2026-07-13T02:00:00.000Z");
  });

  it("parses Uncorked Wine Inspired event grid cards", () => {
    const uncorkedConfig = getCalendarSource("uncorked-wine-inspired");

    if (!uncorkedConfig || uncorkedConfig.sourceType !== "html") {
      throw new Error("Missing Uncorked Wine Inspired calendar config");
    }

    const events = extractUncorkedWineInspiredEvents(
      `
        <div class="grid-box">
          <div class="block">
            <div onclick="window.location='/eventbook-event/?eventid=6412'"></div>
            <div>
              <h2 onclick="window.location='/eventbook-event/?eventid=6412'">FLUTTER</h2>
              <p>SUE  INSTRUCTING</p>
              <p>JULY 06, 2026 AT 7:00PM<br>38.00 PER GUEST</p>
              <div>
                <a class="btn_info" href="https://uncorkedwineinspired.com/eventbook-event/?eventid=6412">BOOK SEATS</a>
                <p>0 of 30 SEATS TAKEN</p>
              </div>
            </div>
          </div>
        </div>
        <div class="grid-box">
          <div class="block">
            <div onclick="window.location='/eventbook-event/?eventid=6416'"></div>
            <div>
              <h2 onclick="window.location='/eventbook-event/?eventid=6416'">TROPICAL SUNSET</h2>
              <p>BRIANA INSTRUCTING</p>
              <p>JULY 11, 2026 AT 3:30PM<br>42.00 PER GUEST</p>
              <div>
                <a class="btn_info" href="/eventbook-event/?eventid=6416">BOOK SEATS</a>
                <p>0 of 30 SEATS TAKEN</p>
              </div>
            </div>
          </div>
        </div>
      `,
      uncorkedConfig,
      {
        sourceUrl:
          "https://uncorkedwineinspired.com/wp-content/plugins/eventbook/calendar-grid.php",
        referenceDate: dayjs("2026-07-03T00:00:00Z"),
      },
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      title: "FLUTTER",
      description: "SUE INSTRUCTING",
      location: "Uncorked Wine Inspired",
      address: "Uncorked Wine Inspired",
      url: "https://uncorkedwineinspired.com/eventbook-event/?eventid=6412",
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-06T23:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-07T01:00:00.000Z");
    expect(events[1]).toMatchObject({
      title: "TROPICAL SUNSET",
      description: "BRIANA INSTRUCTING",
      url: "https://uncorkedwineinspired.com/eventbook-event/?eventid=6416",
    });
    expect(events[1]?.start.toISOString()).toBe("2026-07-11T19:30:00.000Z");
    expect(events[1]?.end.toISOString()).toBe("2026-07-11T21:30:00.000Z");
  });

  it("parses House of Independents event list cards", () => {
    const houseOfIndependentsConfig = getCalendarSource(
      "house-of-independents",
    );

    if (
      !houseOfIndependentsConfig ||
      houseOfIndependentsConfig.sourceType !== "html"
    ) {
      throw new Error("Missing House of Independents calendar config");
    }

    const events = extractEventsFromHtml(
      `
        <div class="col-12 eventWrapper rhpSingleEvent py-4 px-0 rhp-event__single-event--list">
          <div class="eventDateListTop rhp-event__date--list">
            <div id="eventDate" class="mb-0 eventMonth singleEventDate text-uppercase">Fri, Jul 03</div>
          </div>
          <div class="belowLowTicketSection p-2">
            <div class="eventTitleDiv">
              <a id="eventTitle" class="url" href="https://houseofindependents.com/event/90s-night-dance-party-2/house-of-independents/asbury-park-new-jersey/">
                <h2>90’S NIGHT DANCE PARTY</h2>
              </a>
            </div>
            <div class="eventAgeRestriction">Ages 21 and up</div>
            <div class="eventTagLine">House of Independents presents</div>
            <div class="rhpEventDetails">
              <span class="rhp-event__time-text--list">Show: 9 pm || Doors: 9 pm</span>
            </div>
          </div>
        </div>
        <div class="col-12 eventWrapper rhpSingleEvent py-4 px-0 rhp-event__single-event--list">
          <div class="eventDateListTop rhp-event__date--list">
            <div id="eventDate" class="mb-0 eventMonth singleEventDate text-uppercase">Mon, Jul 06</div>
          </div>
          <div class="belowLowTicketSection p-2">
            <div class="eventTitleDiv">
              <a id="eventTitle" class="url" href="/event/elysia/house-of-independents/asbury-park-new-jersey/">
                <h2>Elysia</h2>
              </a>
            </div>
            <div class="eventTagLine">Hellfest Presents..</div>
            <div class="rhpEventDetails">
              <span class="rhp-event__time-text--list">Show: 6:30 pm || Doors: 6 pm</span>
            </div>
          </div>
        </div>
      `,
      houseOfIndependentsConfig,
      "https://houseofindependents.com/events/",
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      title: "90’S NIGHT DANCE PARTY",
      description: "House of Independents presents",
      address: "House of Independents, 572 Cookman Ave, Asbury Park, NJ 07712",
      location: "House of Independents, 572 Cookman Ave, Asbury Park, NJ 07712",
      url: "https://houseofindependents.com/event/90s-night-dance-party-2/house-of-independents/asbury-park-new-jersey/",
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-04T01:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-04T04:00:00.000Z");
    expect(events[1]?.title).toBe("Elysia");
    expect(events[1]?.description).toBe("Hellfest Presents..");
    expect(events[1]?.url).toBe(
      "https://houseofindependents.com/event/elysia/house-of-independents/asbury-park-new-jersey/",
    );
    expect(events[1]?.start.toISOString()).toBe("2026-07-06T22:30:00.000Z");
  });
});

describe("extractEventsFromJson", () => {
  const jsonConfig: JsonCalendarSourceConfig = {
    id: "asbury-park-brewery",
    name: "Asbury Park Brewery",
    sourceType: "json",
    url: "https://www.asburyparkbrewery.com/api/open/GetItemsByMonth?month={month}-{year}&collectionId=abc",
    fields: {
      title: "title",
      start: "startDate",
      end: "endDate",
      url: "fullUrl",
    },
    dateFormat: "epoch-ms",
    defaultAddress:
      "Asbury Park Brewery, 614 Cookman Ave, Asbury Park, NJ 07712",
  };

  it("maps configured JSON fields to normalized calendar events", () => {
    const events = extractEventsFromJson(
      JSON.stringify([
        {
          title: "Newborn Kings",
          fullUrl: "/events/2026/7/3/newborn-kings",
          startDate: 1783119600236,
          endDate: 1783130400236,
        },
        {
          title: "",
          startDate: 1783184400414,
          endDate: 1783195200414,
        },
      ]),
      jsonConfig,
      "https://www.asburyparkbrewery.com/api/open/GetItemsByMonth?month=07-2026&collectionId=abc",
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: "Newborn Kings",
      location: "Asbury Park Brewery, 614 Cookman Ave, Asbury Park, NJ 07712",
      address: "Asbury Park Brewery, 614 Cookman Ave, Asbury Park, NJ 07712",
      url: "https://www.asburyparkbrewery.com/events/2026/7/3/newborn-kings",
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-03T23:00:00.236Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-04T02:00:00.236Z");
  });

  it("supports nested item and field paths with default duration", () => {
    const nestedConfig: JsonCalendarSourceConfig = {
      ...jsonConfig,
      itemsPath: "data.events",
      fields: {
        title: "name",
        start: "dates.start",
      },
      dateFormat: "iso",
      defaultDurationMinutes: 45,
    };
    const events = extractEventsFromJson(
      JSON.stringify({
        data: {
          events: [
            {
              name: "Nested Event",
              dates: {
                start: "2026-07-04T18:00:00Z",
              },
            },
          ],
        },
      }),
      nestedConfig,
      "https://example.com/events.json",
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.start.toISOString()).toBe("2026-07-04T18:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-04T18:45:00.000Z");
  });

  it("parses Wonder Bar API events", () => {
    const wonderBarConfig = getCalendarSource("wonder-bar");

    if (!wonderBarConfig || wonderBarConfig.sourceType !== "json") {
      throw new Error("Missing Wonder Bar calendar config");
    }

    const rawEvents = extractEventsFromJson(
      JSON.stringify([
        {
          id: 24466,
          title: "Promised Land",
          date: {
            start: 1783123200,
            end: 1783123200,
            timezone: "America/New_York",
          },
          details:
            "<p><strong>Promised Land</strong><br />Classic Jersey Shore Music Tribute</p><p>Doors 8:00pm<br />Show 8:30pm</p>",
          ticket: "https://www.ticketmaster.com/event/0000648DC1A6E988",
          more: false,
          info: "American Hit Parade Show",
          venue: {
            name: "Wonder Bar",
            addr: "1213 Ocean Avenue Asbury Park, NJ 07712",
          },
        },
        {
          id: 24871,
          title: "Happy Mondays",
          date: {
            start: 1783378800,
            end: 1783378800,
            timezone: "America/New_York",
          },
          details:
            "<p>SEIKO Presents<br /><strong>HAPPY MONDAYS</strong><br />Free admission</p>",
          ticket: false,
          more: false,
          info: "Honey Bree, James Barrett",
          venue: {
            name: "Wonder Bar",
            addr: "1213 Ocean Avenue Asbury Park, NJ 07712",
          },
        },
      ]),
      wonderBarConfig,
      "https://apboardwalk.com/wp-json/apb/v1/shows/64",
    );
    const events = rawEvents.map((event) => {
      const transformed = wonderBarConfig.transformEvent?.(event) ?? event;

      if (!transformed) {
        throw new Error("Wonder Bar transform unexpectedly removed event");
      }

      return transformed;
    });

    expect(events).toHaveLength(2);
    expect(dayjs.isDayjs(events[0]?.start)).toBe(true);
    expect(dayjs.isDayjs(events[0]?.end)).toBe(true);
    expect(events[0]).toMatchObject({
      title: "Promised Land",
      description:
        "Promised Land Classic Jersey Shore Music Tribute Doors 8:00pm Show 8:30pm",
      address: "1213 Ocean Avenue Asbury Park, NJ 07712",
      location: "1213 Ocean Avenue Asbury Park, NJ 07712",
      url: "https://www.ticketmaster.com/event/0000648DC1A6E988",
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-04T00:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-04T03:00:00.000Z");
    expect(events[1]?.title).toBe("Happy Mondays");
    expect(events[1]?.url).toBeUndefined();
  });
});

describe("extractEventsFromIcs", () => {
  const icsConfig: IcsCalendarSourceConfig = {
    id: "city",
    name: "City",
    sourceType: "ics",
    url: "https://example.com/calendar.ics",
    timeZone: "America/New_York",
    defaultDurationMinutes: 60,
  };

  it("parses VEVENT fields into normalized calendar events", () => {
    const events = extractEventsFromIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "SUMMARY:Council Meeting",
        "DTSTART;TZID=America/New_York:20260706T190000",
        "DTEND;TZID=America/New_York:20260706T203000",
        "DESCRIPTION:Agenda\\nPublic comment",
        "LOCATION:<p>City Hall<br>1 Municipal Plaza</p>",
        "URL:https://example.com/events/1",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
      icsConfig,
    );

    expect(events).toHaveLength(1);
    expect(dayjs.isDayjs(events[0]?.start)).toBe(true);
    expect(dayjs.isDayjs(events[0]?.end)).toBe(true);
    expect(events[0]).toMatchObject({
      title: "Council Meeting",
      description: "Agenda Public comment",
      location: "<p>City Hall<br>1 Municipal Plaza</p>",
      address: "<p>City Hall<br>1 Municipal Plaza</p>",
      url: "https://example.com/events/1",
    });
    expect(events[0]?.start.toISOString()).toBe("2026-07-06T23:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-07T00:30:00.000Z");
  });

  it("unfolds long lines and applies default duration", () => {
    const events = extractEventsFromIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "SUMMARY:Folded",
        " continuation",
        "DTSTART:20260706T190000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
      icsConfig,
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("Foldedcontinuation");
    expect(events[0]?.start.toISOString()).toBe("2026-07-06T19:00:00.000Z");
    expect(events[0]?.end.toISOString()).toBe("2026-07-06T20:00:00.000Z");
  });

  it("strips html from event locations", () => {
    const event = stripHtmlFromEventLocation({
      title: "HTML Location",
      start: dayjs("2026-07-06T19:00:00Z"),
      end: dayjs("2026-07-06T20:00:00Z"),
      location: "<p>City Hall<br>1 Municipal Plaza &amp; Offices</p>",
      address: "<p>City Hall<br>1 Municipal Plaza &amp; Offices</p>",
    });

    expect(event.location).toBe("City Hall 1 Municipal Plaza & Offices");
    expect(event.address).toBe("City Hall 1 Municipal Plaza & Offices");
  });

  it("removes embedded css when stripping html from event locations", () => {
    const event = stripHtmlFromEventLocation({
      title: "CSS Location",
      start: dayjs("2026-08-28T21:00:00Z"),
      end: dayjs("2026-08-28T23:00:00Z"),
      location:
        '<style>p.p1 {margin: 0.0px 0.0px 0.0px 0.0px; font: 12.0px Helvetica}</style><p class="p1">Pine Street between Second and Third Avenues - Asbury Park NJ 07712</p>',
    });

    expect(event.location).toBe(
      "Pine Street between Second and Third Avenues - Asbury Park NJ 07712",
    );
  });

  it("preserves date-only ICS entries as all-day events", () => {
    const events = extractEventsFromIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "SUMMARY:All Day City Event",
        "DTSTART;VALUE=DATE:20260828",
        "DTEND;VALUE=DATE:20260829",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
      icsConfig,
    );
    const feed = eventsToIcs("City", events);

    expect(events).toHaveLength(1);
    expect(events[0]?.allDay).toBe(true);
    expect(feed).toContain("DTSTART;VALUE=DATE:20260828");
    expect(feed).toContain("DTEND;VALUE=DATE:20260829");
  });
});

describe("filterCalendarEvents", () => {
  const events = [
    {
      title: "Promised Land",
      start: dayjs("2026-07-04T00:00:00Z"),
      end: dayjs("2026-07-04T03:00:00Z"),
      description: "Classic Jersey Shore Music Tribute",
      location: "Wonder Bar",
    },
    {
      title: "Happy Mondays",
      start: dayjs("2026-07-06T23:00:00Z"),
      end: dayjs("2026-07-07T02:00:00Z"),
      description: "Free admission",
      location: "Wonder Bar",
    },
    {
      title: "Council Meeting",
      start: dayjs("2026-07-07T23:00:00Z"),
      end: dayjs("2026-07-08T00:00:00Z"),
      location: "City Hall",
    },
    {
      title: "Open Bowling",
      start: dayjs("2026-07-08T18:00:00Z"),
      end: dayjs("2026-07-08T20:00:00Z"),
      location: "Bowling Alley",
    },
  ];

  it("includes events matching any positive filter", () => {
    expect(
      filterCalendarEvents(events, ["promised", "council"]).map(
        (event) => event.title,
      ),
    ).toEqual(["Promised Land", "Council Meeting"]);
  });

  it("excludes events matching any negated filter", () => {
    expect(
      filterCalendarEvents(events, ["!wonder", "!council"]).map(
        (event) => event.title,
      ),
    ).toEqual(["Open Bowling"]);
  });

  it("combines include and exclude filters", () => {
    expect(
      filterCalendarEvents(events, ["wonder", "!promised"]).map(
        (event) => event.title,
      ),
    ).toEqual(["Happy Mondays"]);
  });

  it("ignores empty filters and matches case-insensitively", () => {
    expect(
      filterCalendarEvents(events, ["", "  MONDAYS  "]).map(
        (event) => event.title,
      ),
    ).toEqual(["Happy Mondays"]);
  });

  it("does not filter against event descriptions", () => {
    expect(
      filterCalendarEvents(events, ["classic", "!free"]).map(
        (event) => event.title,
      ),
    ).toEqual([]);
  });

  it("applies default filters before request filters", () => {
    expect(
      filterCalendarEvents(events, undefined, ["!open bowling"]).map(
        (event) => event.title,
      ),
    ).toEqual(["Promised Land", "Happy Mondays", "Council Meeting"]);
  });
});

describe("renderSourceUrl", () => {
  it("replaces year and zero-padded month tokens", () => {
    expect(
      renderSourceUrl(
        "https://example.com/{year}/{month}",
        dayjs("2026-07-03T00:00:00Z"),
      ),
    ).toBe("https://example.com/2026/07");
  });

  it("renders this month and next month when template contains month token", () => {
    expect(
      renderSourceUrls(
        "https://example.com/{year}/{month}",
        dayjs("2026-12-03T00:00:00Z"),
      ),
    ).toEqual([
      "https://example.com/2026/12",
      "https://example.com/2027/01",
      "https://example.com/2027/02",
    ]);
  });

  it("renders one source URL when template has no month token", () => {
    expect(
      renderSourceUrls(
        "https://example.com/events",
        dayjs("2026-07-03T00:00:00Z"),
      ),
    ).toEqual(["https://example.com/events"]);
  });
});

describe("fetchCalendarEvents", () => {
  it("fetches upstream HTML for repeated direct calendar event fetches", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          `
          <article>
            <h2 class="event-title">Cached Event</h2>
            <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          </article>
        `,
        ),
    );
    const noTokenConfig: CalendarSourceConfig = {
      ...config,
      url: "https://example.com/events",
    };

    const first = await fetchCalendarEvents(
      noTokenConfig,
      dayjs("2026-07-03T00:00:00Z"),
    );
    const second = await fetchCalendarEvents(
      noTokenConfig,
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.fetchStatus).toBe("fetched");
    expect(second.fetchStatus).toBe("fetched");
    expect(second.events[0]?.title).toBe("Cached Event");
  });

  it("fetches this month and the next two months when URL has month token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        const title = url.endsWith("/09")
          ? "Third Month Event"
          : url.endsWith("/08")
            ? "Next Month Event"
            : "This Month Event";

        return new Response(
          `
          <article>
            <h2 class="event-title">${title}</h2>
            <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          </article>
        `,
        );
      });

    const result = await fetchCalendarEvents(
      config,
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.sourceUrls).toEqual([
      "https://example.com/events/2026/07",
      "https://example.com/events/2026/08",
      "https://example.com/events/2026/09",
    ]);
    expect(result.fetchStatuses).toEqual(["fetched", "fetched", "fetched"]);
    expect(result.events.map((event) => event.title)).toEqual([
      "This Month Event",
      "Next Month Event",
      "Third Month Event",
    ]);
  });

  it("fetches one URL when URL has no month token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `
          <article>
            <h2 class="event-title">Single URL Event</h2>
            <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          </article>
        `,
      ),
    );

    const noTokenConfig: CalendarSourceConfig = {
      ...config,
      url: "https://example.com/events",
    };
    const result = await fetchCalendarEvents(
      noTokenConfig,
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.sourceUrls).toEqual(["https://example.com/events"]);
    expect(result.events[0]?.title).toBe("Single URL Event");
  });

  it.each(["No events found", "Page Not Found"])(
    "treats 404 %s HTML as an empty source page",
    async (emptyPageText) => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(`<p>${emptyPageText}</p>`, { status: 404 }),
        );
      const noTokenConfig: CalendarSourceConfig = {
        ...config,
        url: "https://example.com/events",
      };

      const result = await fetchCalendarEvents(
        noTokenConfig,
        dayjs("2026-07-03T00:00:00Z"),
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.fetchStatus).toBe("fetched");
      expect(result.fetchStatuses).toEqual(["fetched"]);
      expect(result.events).toEqual([]);
    },
  );

  it("parses events before classifying non-OK empty source page text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `
          <article>
            <h2 class="event-title">No Events Found Fundraiser</h2>
            <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          </article>
        `,
        { status: 404 },
      ),
    );
    const noTokenConfig: CalendarSourceConfig = {
      ...config,
      url: "https://example.com/events",
    };

    const result = await fetchCalendarEvents(
      noTokenConfig,
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(result.fetchStatus).toBe("fetched");
    expect(result.events.map((event) => event.title)).toEqual([
      "No Events Found Fundraiser",
    ]);
  });

  it("throws when non-OK HTML is not a known empty source page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<p>Server error</p>", { status: 500 }),
    );
    const noTokenConfig: CalendarSourceConfig = {
      ...config,
      url: "https://example.com/events",
    };

    await expect(
      fetchCalendarEvents(noTokenConfig, dayjs("2026-07-03T00:00:00Z")),
    ).rejects.toThrow("Failed to fetch https://example.com/events: 500");
  });

  it("fetches and parses JSON source calendars", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            title: "JSON Event",
            startDate: 1783184400414,
            endDate: 1783195200414,
            fullUrl: "/events/json-event",
          },
        ]),
      ),
    );
    const jsonConfig: CalendarSourceConfig = {
      id: "json-source",
      name: "JSON Source",
      sourceType: "json",
      url: "https://example.com/api/events?month={month}-{year}",
      fields: {
        title: "title",
        start: "startDate",
        end: "endDate",
        url: "fullUrl",
      },
      dateFormat: "epoch-ms",
    };
    const result = await fetchCalendarEvents(
      jsonConfig,
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.sourceUrls).toEqual([
      "https://example.com/api/events?month=07-2026",
      "https://example.com/api/events?month=08-2026",
      "https://example.com/api/events?month=09-2026",
    ]);
    expect(result.events[0]?.title).toBe("JSON Event");
    expect(result.events[0]?.url).toBe("https://example.com/events/json-event");
  });

  it("fetches and transforms ICS source calendars", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        [
          "BEGIN:VCALENDAR",
          "BEGIN:VEVENT",
          "SUMMARY:ICS Event",
          "DTSTART:20260706T190000Z",
          "DTEND:20260706T200000Z",
          "LOCATION:<p>City Hall<br>1 Municipal Plaza</p>",
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\r\n"),
      ),
    );
    const icsConfig: CalendarSourceConfig = {
      id: "ics-source",
      name: "ICS Source",
      sourceType: "ics",
      url: "https://example.com/calendar.ics",
      transformEvent: stripHtmlFromEventLocation,
    };
    const result = await fetchCalendarEvents(
      icsConfig,
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(result.sourceUrls).toEqual(["https://example.com/calendar.ics"]);
    expect(result.events[0]?.title).toBe("ICS Event");
    expect(result.events[0]?.location).toBe("City Hall 1 Municipal Plaza");
  });

  it("fetches and parses ShowRoom Cinemas coming-soon listings", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `
          <div class="show-list">
            <div class="show-details">
              <div class="showtimes-description">
                <h2 class="show-title">
                  <a class="title" href="https://showroomcinemas.com/movies/from-russia-with-love/">From Russia with Love</a>
                </h2>
                <ul class="datelist">
                  <li class="show-date first selected" data-date="1783494000">
                    <span>Wed,  Jul 8</span>
                  </li>
                </ul>
                <ol class="showtimes showtime-button-row">
                  <li data-date="1783494000">
                    <a href="https://showroomcinemas.com/purchase/259184/" class="showtime">7:30 pm</a>
                  </li>
                </ol>
                <div class="show-content"><p>The world's masters of murder pull out all the stops.</p></div>
              </div>
            </div>
            <div class="show-details">
              <div class="showtimes-description">
                <h2 class="show-title">
                  <a class="title" href="https://showroomcinemas.com/movies/jaws/">Jaws</a>
                </h2>
                <ul class="datelist">
                  <li class="show-date first selected" data-date="1783753200">
                    <span>Sat,  Jul 11</span>
                  </li>
                  <li class="show-date" data-date="1784098800">
                    <span>Wed,  Jul 15</span>
                  </li>
                </ul>
                <ol class="showtimes showtime-button-row">
                  <li data-date="1783753200">
                    <a href="https://showroomcinemas.com/purchase/257805/" class="showtime">7:30 pm</a>
                  </li>
                  <li data-date="1784098800" style="display: none">
                    <a href="https://showroomcinemas.com/purchase/257807/" class="showtime">7:30 pm</a>
                  </li>
                </ol>
                <div class="show-content"><p>The terrifying motion picture.</p></div>
              </div>
            </div>
            <div class="show-details">
              <div class="showtimes-description">
                <h2 class="show-title">
                  <a class="title" href="https://showroomcinemas.com/movies/a-cell-phone-movie/">A Cell Phone Movie</a>
                </h2>
                <div class="showtimes-container clearfix no-showtimes">
                  <div class="date-selector empty">
                    <div class="no-showtimes-date">Opens on August 7</div>
                  </div>
                </div>
                <div class="show-content"><p>It's Just like Rocky.</p></div>
              </div>
            </div>
          </div>
        `,
      ),
    );
    const showroomConfig = getCalendarSource("showroom-cinemas");

    if (!showroomConfig) {
      throw new Error("Missing ShowRoom Cinemas calendar config");
    }

    const result = await fetchCalendarEvents(
      showroomConfig,
      dayjs("2026-07-03T00:00:00Z"),
    );

    expect(result.sourceUrls).toEqual([
      "https://showroomcinemas.com/coming-soon/",
    ]);
    expect(result.events).toHaveLength(4);
    expect(result.events[0]).toMatchObject({
      title: "From Russia with Love",
      description: "The world's masters of murder pull out all the stops.",
      address: "ShowRoom Cinemas, 707 Cookman Avenue, Asbury Park, NJ 07712",
      location: "ShowRoom Cinemas, 707 Cookman Avenue, Asbury Park, NJ 07712",
      url: "https://showroomcinemas.com/purchase/259184/",
    });
    expect(result.events[0]?.start.toISOString()).toBe(
      "2026-07-08T23:30:00.000Z",
    );
    expect(result.events[0]?.end.toISOString()).toBe(
      "2026-07-09T01:30:00.000Z",
    );
    expect(result.events[1]?.title).toBe("Jaws");
    expect(result.events[1]?.start.toISOString()).toBe(
      "2026-07-11T23:30:00.000Z",
    );
    expect(result.events[2]?.title).toBe("Jaws");
    expect(result.events[2]?.start.toISOString()).toBe(
      "2026-07-15T23:30:00.000Z",
    );
    expect(result.events[2]?.url).toBe(
      "https://showroomcinemas.com/purchase/257807/",
    );
    expect(result.events[3]).toMatchObject({
      title: "A Cell Phone Movie",
      allDay: true,
      url: "https://showroomcinemas.com/movies/a-cell-phone-movie/",
    });
    expect(result.events[3]?.start.toISOString()).toBe(
      "2026-08-07T04:00:00.000Z",
    );
    expect(result.events[3]?.end.toISOString()).toBe(
      "2026-08-08T04:00:00.000Z",
    );
  });

  it("stores set-cookie values by host and sends cookie pairs back", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        const response = new Response(
          `
          <article>
            <h2 class="event-title">Cookie Event</h2>
            <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          </article>
        `,
        );
        Object.defineProperty(response.headers, "getSetCookie", {
          value: () => [
            "X_Obolus_Proof=abc123; Path=/; HttpOnly",
            "source_session=def456; Secure",
          ],
        });

        return response;
      });
    const noCacheConfig: CalendarSourceConfig = {
      ...config,
      url: "https://example.com/events",
    };

    await fetchCalendarEvents(noCacheConfig, dayjs("2026-07-03T00:00:00Z"));
    await fetchCalendarEvents(noCacheConfig, dayjs("2026-07-03T00:00:00Z"));

    const secondRequestHeaders = fetchMock.mock.calls[1]?.[1]
      ?.headers as Record<string, string>;

    expect(secondRequestHeaders.cookie).toBe(
      "X_Obolus_Proof=abc123; source_session=def456",
    );
  });

  it("does not send cookies across source hosts", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        const response = new Response(
          `
          <article>
            <h2 class="event-title">Host Event</h2>
            <time class="start" datetime="2026-07-04T18:00:00Z">July 4</time>
          </article>
        `,
          {
            headers: {
              "set-cookie": "source_session=example-cookie; Path=/",
            },
          },
        );

        return response;
      });
    const exampleConfig: CalendarSourceConfig = {
      ...config,
      url: "https://example.com/events",
    };
    const otherConfig: CalendarSourceConfig = {
      ...config,
      url: "https://events.example.net/events",
    };

    await fetchCalendarEvents(exampleConfig, dayjs("2026-07-03T00:00:00Z"));
    await fetchCalendarEvents(otherConfig, dayjs("2026-07-03T00:00:00Z"));

    const secondRequestHeaders = fetchMock.mock.calls[1]?.[1]
      ?.headers as Record<string, string>;

    expect(secondRequestHeaders.cookie).toBeUndefined();
  });
});
