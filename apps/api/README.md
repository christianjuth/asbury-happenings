# Chaotic Backend

TypeScript Node.js backend scaffold with Fastify, Vitest, and Docker.

## Why No Vite Bundler

Backend code builds cleanly with `tsc`. Vite is not needed for runtime bundling here. Vitest is included for tests and uses Vite internally.

## First Run

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Health check:

```bash
curl http://localhost:3000/health
```

List configured calendars:

```bash
curl http://localhost:3000/calendar
```

Calendar feed:

```bash
curl http://localhost:3000/calendar/example-events.ics
curl http://localhost:3000/calendar/tim-mcloones-supper-club.ics
curl http://localhost:3000/happy-hours/asbury-park.ics
```

Plain-text debug output:

```bash
curl "http://localhost:3000/calendar/example-events.ics?debug=1"
```

Debug output includes cache page status. `warming` means that page has not been fetched by the background job yet.

Happy hour debug output:

```bash
curl "http://localhost:3000/happy-hours/asbury-park.ics?debug=1"
```

## Docker

Build and run app:

```bash
docker compose up --build
```

## Fly.io

This app listens on `0.0.0.0:3000`. Fly's generated config used port `8080`, which makes the proxy time out. `fly.toml` is updated to:

```toml
[env]
  PORT = '3000'
  HOST = '0.0.0.0'

[http_service]
  internal_port = 3000
```

Redeploy after changing Fly config:

```bash
fly deploy
```

## Scripts

```bash
pnpm dev        # local dev with tsx watch
pnpm build      # compile TypeScript to dist
pnpm start      # run compiled app
pnpm test       # run Vitest
pnpm lint       # typecheck
```

## Calendar Endpoint

`GET /calendar/:calendarId.ics`

`GET /calendar/:calendarId.ics?debug=1`

Calendar sources are configured in `src/calendar/calendar.config.ts`. Each source defines:

```ts
{
  id: "example-events",
  name: "Example Events",
  url: "https://example.com/events/{year}/{month}",
  containerSelector: "article",
  selectors: {
    title: ".event-title",
    start: { selector: "time.start", attr: "datetime" },
    end: { selector: "time.end", attr: "datetime" },
    location: ".location",
    address: ".address",
    description: ".description",
    url: { selector: "a.details", attr: "href" }
  },
  timeZone: "America/New_York",
  defaultAddress: "Asbury Book Cooperative, 644A Cookman Ave, Asbury Park, NJ 07712"
}
```

Date parsing is forgiving by default for common date shapes like `Jul 02`, `July 2`, `7/2/2026`, and `2026-07-02`. Set `timeZone` to parse site-local times before converting to UTC for the ICS feed. Use IANA timezone names like `America/New_York`; this handles EST/EDT daylight saving changes. Date selectors can include `format` for site-specific dates:

```ts
start: {
  selector: ".event-date",
  format: "MMM DD"
}
```

Text like `Jul 02` uses the current UTC year when the matched format does not include a year. `dateFormats` on the source can provide fallback formats.

Date and time can also be split across config fields. `pattern` extracts the first capture group from selected text:

```ts
selectors: {
  title: ".event-list__title",
  startDate: {
    selector: ".event-list__details",
    pattern: /[A-Za-z]{3},\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
    format: "M/D/YYYY"
  },
  startTime: {
    selector: ".event-list__details",
    pattern: /([0-9]{1,2}:[0-9]{2}\s*[ap]m)\s*-/i,
    format: ["h:mma", "h:mm a"]
  },
  endTime: {
    selector: ".event-list__details",
    pattern: /-\s*([0-9]{1,2}:[0-9]{2}\s*[ap]m)/i,
    format: ["h:mma", "h:mm a"]
  }
}
```

Descriptions can be read from a specific child selector, or from the whole event container with `:self`. Use `remove` to strip title/date/link elements first:

```ts
description: {
  selector: ":self",
  remove: [".event-list__title", ".event-list__details", ".event-list__links"]
}
```

Addresses can be parsed with `address`; if no separate `location` is found, the address becomes the ICS `LOCATION`. Use `defaultAddress` for venues where every event has the same address but the listing sometimes omits it.

`{year}` and `{month}` use the current UTC year and zero-padded month. If a source URL contains `{month}`, the app caches this month plus the next two months. URLs without `{month}` have one cache page. Each `containerSelector` match becomes one event. `title` plus either `start` or `startDate` are required; containers missing them are skipped. If no end date/time is found, `defaultDurationMinutes` is used.

The app keeps parsed calendar pages in memory. On startup it kicks off every page for every calendar immediately, then refreshes each calendar every 15 minutes. Sources with `{month}` warm this month plus the next two months; sources without `{month}` have one page. Each calendar has its own scheduler queue, so failures back off with jitter for that calendar without slowing other calendars. Calendar routes return only cached data and respond with `503 Calendar cache warming` until at least one page is warm.

Fly is configured with `min_machines_running = 1` so the scheduler keeps running.

## Happy Hour Endpoint

`GET /happy-hours`

`GET /happy-hours/asbury-park.ics`

`GET /happy-hours/asbury-park.ics?debug=1`

The happy-hour service crawls `https://asburypark.rectalogic.com/#restaurant-happy-hours`, parses each restaurant's `time.dayhour` rows, and emits one recurring weekly ICS event per restaurant/day/time slot. The event summary is the restaurant name. Event descriptions include specials plus phone, verified date, menu, Instagram, and map links when present.

## Add Redis Later

Skip Redis until the scrape is slow, flaky, rate-limited, or expensive. Add it once there is a measured reason to cache generated feeds.
