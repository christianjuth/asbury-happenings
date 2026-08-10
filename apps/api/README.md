# Calendar Service

TypeScript and Fastify backend that turns event listings into cached iCalendar
feeds. It also serves the Asbury Park happy-hour calendar and Nixle RSS feeds.

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

Calendar feeds:

```bash
curl http://localhost:3000/calendar/tim-mcloones-supper-club.ics
curl http://localhost:3000/happy-hours/asbury-park.ics
```

Plain-text debug output:

```bash
curl "http://localhost:3000/calendar/tim-mcloones-supper-club.ics?debug=1"
curl "http://localhost:3000/happy-hours/asbury-park.ics?debug=1"
```

Calendar debug output includes per-page fetch and revalidation status. `Fetch:
upstream fetched` means the last background warm fetched and parsed the page.
Snapshots are fresh for 30 minutes, then due until the next warm starts.
`refetching` means a warm is in progress, `warming` means no snapshot exists,
and `error` means the latest refresh failed.

## Endpoints

### Calendars

```text
GET /calendar
GET /calendar/:calendarId.ics
GET /calendar/:calendarId.ics?debug=1
GET /calendar/status.ics
```

Calendar sources are configured under `src/calendar/config/` and aggregated by
`src/calendar/calendar.config.ts`. A typical HTML source defines selectors for
the event fields:

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
    description: ".description",
    url: { selector: "a.details", attr: "href" },
  },
  timeZone: "America/New_York",
  defaultDurationMinutes: 60,
}
```

Date parsing supports common date shapes such as `Jul 02`, `July 2`,
`7/2/2026`, and `2026-07-02`. Set `timeZone` to parse source-local times before
converting them for the ICS feed. Date selectors can provide `format` or an
array of formats for source-specific values.

Date and time can be selected separately. A selector's `pattern` extracts its
first capture group:

```ts
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
}
```

Descriptions can select the whole event container with `:self` and remove
unwanted child elements first. If no separate location is found, `address`
becomes the ICS `LOCATION`. `defaultAddress` supports venues where every event
uses the same address.

`{year}` and `{month}` in source URLs use the current UTC year and a zero-padded
month. Sources with `{month}` cache this month plus the next two months; sources
without it have one page.

The process warms all calendar pages on startup and refreshes each calendar
every 30 minutes. Each source has its own queue and failure backoff, so one
failing source does not delay the others. Routes serve only cached data and
return `503 Calendar cache warming` until at least one page is ready. The status
calendar reports sources whose latest snapshot is stale or failed.

### Happy Hour

```text
GET /happy-hours
GET /happy-hours/asbury-park.ics
GET /happy-hours/asbury-park.ics?debug=1
```

The happy-hour service crawls the Asbury Park restaurant listing and emits one
recurring weekly ICS event per restaurant, day, and time slot. Data is warmed on
startup and refreshed every 60 minutes.

### Nixle

```text
GET /rss
GET /rss/:feedId.xml
```

Nixle profile pages are exposed as short-lived cached RSS feeds.

## Feature Boundaries

`feature-boundaries.config.js` is an opt-in dependency allowlist enforced by
`import-x/no-restricted-paths`. Each edge points from an importing feature to an
imported feature. Same-feature imports and imports from unenrolled shared
infrastructure are allowed.

## Docker

```bash
docker compose up --build
```

## Fly.io

The app listens on `0.0.0.0:3000`. `fly.toml` keeps one machine running so the
background calendar schedulers continue to refresh their caches.

```bash
fly deploy
```

## Scripts

```bash
pnpm dev          # local development with tsx watch
pnpm build        # compile TypeScript to dist
pnpm start        # run the compiled app
pnpm test         # run Vitest
pnpm test:ts      # typecheck without emitting
pnpm lint         # run ESLint
pnpm format:check # verify Prettier formatting
```
