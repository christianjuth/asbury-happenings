# Calendar Service

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

Debug output includes per-page fetch and revalidate status. `Fetch: upstream fetched` means the last background warm fetched that page from the upstream site and stored a parsed snapshot. `snapshot` is when that page was last fetched. Calendar snapshots are `fresh` for 30 minutes, then `due` until the next warm starts. `refetching` means a warm is in progress, `warming` means no snapshot exists yet, and `error` means the last refresh failed.

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
pnpm indexnow   # manual IndexNow full reconciliation
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

The app keeps parsed calendar pages in memory. On startup it kicks off every page for every calendar immediately, then refreshes each calendar every 30 minutes. That 30-minute scheduler cadence is the only normal upstream crawl cadence for calendar sources. Sources with `{month}` warm this month plus the next two months; sources without `{month}` have one page. Each calendar has its own scheduler queue, so failures back off with jitter for that calendar without slowing other calendars. Calendar routes return only cached data and respond with `503 Calendar cache warming` until at least one page is warm.

Fly is configured with `min_machines_running = 1` so the scheduler keeps running.

## IndexNow Submissions

`src/index-now/index-now.service.ts` notifies [IndexNow](https://www.indexnow.org/)
when Samantha Dress event pages materially change, so search engines recrawl
`samanthadress.com` without waiting for their own schedule. The service owns
request construction, key handling, URL batching, event fingerprinting, and the
in-memory record of what has already been submitted. Nothing else in the app
talks to IndexNow; `src/index-now/index-now.scheduler.ts` is the only wiring, and
it hooks into the calendar cache rather than into routes or rendering.

There is no database. Submitted state lives in a `Map` keyed by event UID, and
the daily reconciliation job is the recovery path after a restart, a lost map, a
transient IndexNow failure, or a defect in the diff logic.

### Generating and configuring the key

1. Generate a key: any hex string of 8–128 characters, e.g.
   `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`.
   Bing's [IndexNow page](https://www.bing.com/indexnow) can also generate one.
2. Publish the matching verification file at
   `https://samanthadress.com/<INDEXNOW_KEY>.txt`. The file's only content is the
   key itself. It lives in the samanthadress.com site repo (the Cloudflare Pages
   `public/` directory), not in this service. IndexNow rejects submissions with
   `403` when the file is missing and `422` when its contents do not match.
3. Set `INDEXNOW_KEY` for this service:
   - locally, in `.env` (see `.env.example`);
   - on Fly, with `fly secrets set INDEXNOW_KEY=<key>`. Keep it out of
     `fly.toml`, which is committed.

The key is never logged in full; log lines carry a masked `key` field such as
`"0123…"`, and any occurrence of the key in an IndexNow response body is replaced
with `[redacted]`.

### Disabling the service

Leave `INDEXNOW_KEY` unset (or empty). The service disables itself, logs one
startup line, and every later call is a no-op:

```
IndexNow disabled because INDEXNOW_KEY is not configured
```

No submissions are attempted and nothing else in the app changes. IndexNow
failures never propagate: submissions are awaited inside the service, every
error is caught and logged, and the calendar scheduler is not blocked on them.

### Incremental submissions

The Samantha Dress calendar is refreshed on the shared calendar cache cadence
(`CACHE_REFRESH_MS` in `src/calendar/calendar.cache.ts`, currently 30 minutes —
this is the app's only upstream crawl cadence, so IndexNow follows it instead of
running its own 15-minute timer). After each cycle in which every page warmed
successfully:

1. The cache notifies its refresh listeners with the current snapshot.
2. The first successful refresh after startup only **seeds** fingerprints, so a
   restart never looks like a calendar full of changes and restart loops do not
   produce submission bursts.
3. Every later refresh compares each event's fingerprint against the last
   fingerprint that IndexNow accepted.
4. Changed and new events produce one deduplicated batch containing the event
   detail URL, `https://samanthadress.com/events`, and the event's regional page.
   When an event moves between regions, both the previous and the new regional
   page are submitted.
5. Fingerprints are updated **only** after IndexNow accepts the batch. A rejected
   or failed batch leaves them untouched, so the next refresh retries the same
   events.

A cancellation is a material change. Cancelled events stay in the feed rather
than disappearing, and `isEventCancelled` in `src/calendar/calendar.utils.ts`
mirrors samanthadress.com's `isEventCanceled` so both sides agree on what counts:

- `STATUS:CANCELLED` on the VEVENT, **or**
- a summary containing `canceled` or `cancelled`, in any case.

Organizers use both, sometimes only retitling the event, so a summary-only
cancellation triggers a submission just like a status change. `test/calendar.service.test.ts`
pins the rule; keep it in sync when the frontend definition changes.

The generated ICS feed carries `STATUS` through from the source calendar, since
the site reads it off this feed to render cancellations. Dropping it would leave
a status-only cancellation invisible to every consumer downstream.

Fingerprints are a SHA-256 over normalized `uid`, `summary`, `startDate`,
`endDate`, `allDay`, `location`, `description`, `status` and the derived
`cancelled` flag. Values are trimmed, whitespace-collapsed, absent values become
`null`, dates serialize as UTC ISO strings, and the field order is fixed, so
unrelated feed churn does not trigger submissions.

### Daily reconciliation

A daily job resubmits the full canonical URL set: `/events`, every upcoming event
detail URL (including future cancelled events, which stay published), and every
regional page those events resolve to. "Upcoming" is judged against the event day
in `America/New_York`, not the server's zone, so an evening event drops out after
its own local day rather than lingering nearly an extra day on a UTC host. The batch is deduplicated and sent as one
request; afterwards the fingerprint map is rebuilt from the current calendar. At
fewer than 20 upcoming events, resubmitting everything once a day is cheap.

It runs at `07:00` UTC (roughly 3am America/New_York), anchored to the clock
rather than counting 24 hours from boot, so a deploy does not push the next run a
full day out. It never runs at startup, which keeps a restart loop from
submitting in bursts.

If the anchor hour arrives before the calendar cache has warmed — a restart a few
minutes before `07:00` — the run is deferred and retried every 15 minutes until a
successful refresh. Reconciling against a cold cache would submit a lone
`/events` and then overwrite the fingerprint map with an empty snapshot, leaving
the real event URLs unsubmitted for a day.

This job is the recovery path for process restarts, lost in-memory state,
transient IndexNow failures, missed incremental comparisons, downtime, and future
defects in the diff logic.

### Running a submission manually

Locally, from a checkout:

```bash
INDEXNOW_KEY=<key> pnpm indexnow
```

On the deployed machine, run the compiled entry point directly:

```bash
fly ssh console -C "node /app/dist/index-now/index-now.cli.js"
```

`pnpm indexnow` does not work there: it runs through `tsx`, a devDependency the
production image prunes, and the image ships `dist` without `src`. The Fly
machine already has `INDEXNOW_KEY` in its environment.

Either way this runs a full reconciliation in a separate process: it fetches and
parses the calendar directly (it does not read the server's warm cache), submits
one batch, and prints JSON log lines. It exits non-zero when `INDEXNOW_KEY` is
missing. The long-running server keeps its own in-memory state, so a manual run
does not affect the server's next incremental diff.

A manual run is the fastest way to check a new key: `200` means IndexNow fetched
and matched the key file, `403` means it fetched something that did not match,
and `202` means validation is still pending and the run proves nothing on its
own. When a submission returns `202`, verify the key file directly —
`curl -i https://samanthadress.com/<key>.txt` must return the key as plain text
and nothing else.

### URL rules

Only canonical `https://samanthadress.com` pages are submitted:

- `https://samanthadress.com/events`
- `https://samanthadress.com/events/<state>/<city>`
- `https://samanthadress.com/events/<state>/<city>/<YYYY-MM-DD>/<uid>`

Event URLs are generated only for IndexNow from the existing
`samanthaDressEventUrl` helper in `src/calendar/config/samantha-dress.ts`, so
calendar normalization does not rewrite the source event's `url`. The helper
requires a parsed city and state from the event address; events whose address
cannot be parsed are skipped entirely. Anything else is dropped before the
request is built: search URLs, query-string or fragment variants, trailing-slash
aliases, `http://`, other hosts, and calendar-source URLs. A regional page is
submitted only when the same address resolves to a real city and state.

### Expected log messages

| Message                                                                   | Level | Meaning                                                                                                            |
| ------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| `IndexNow disabled because INDEXNOW_KEY is not configured`                | info  | Startup, key absent. Logged once.                                                                                  |
| `IndexNow enabled for Samantha Dress calendar refreshes`                  | info  | Startup, key present.                                                                                              |
| `IndexNow seeded event fingerprints without submitting`                   | info  | First successful calendar refresh after startup.                                                                   |
| `IndexNow submission accepted`                                            | info  | `200` or `202`. Includes `status`, `urlCount`, `urls`, `reason`.                                                   |
| `IndexNow submission accepted with an unexpected response body`           | warn  | Accepted, but the response carried a body worth reading.                                                           |
| `IndexNow submission rejected`                                            | error | `400` malformed request, `403` key not found, `422` key/URL mismatch, `429` throttled. Includes the response body. |
| `IndexNow submission failed`                                              | error | Network error or timeout. Retried once, then left for the next cycle.                                              |
| `IndexNow daily reconciliation deferred until the calendar cache is warm` | warn  | The anchor hour arrived before the first successful calendar refresh. Retries in 15 minutes.                       |

Every submission line carries both `trigger` (`manual` from the CLI, `scheduled`
from the server) and `reason` (`incremental` or `reconciliation`). `reason` alone
does not identify the source, because a manual run performs the same
reconciliation the daily job does. Submission context also includes
`unresolvedAddressEvents`, the number of visible calendar events skipped because
their location could not produce a valid city/state URL.

Quiet cycles are silent by design: when nothing changed, no request is made and
nothing is logged.

## Happy Hour Endpoint

`GET /happy-hours`

`GET /happy-hours/asbury-park.ics`

`GET /happy-hours/asbury-park.ics?debug=1`

The happy-hour service crawls `https://asburypark.rectalogic.com/#restaurant-happy-hours`, parses each restaurant's `time.dayhour` rows, and emits one recurring weekly ICS event per restaurant/day/time slot. The event summary is the restaurant name. Event descriptions include specials plus phone, verified date, menu, Instagram, and map links when present.

Happy-hour data is also warmed in memory on startup and refreshed every 60 minutes. Happy-hour routes return only cached data and do not crawl upstream during request handling.

## Add Redis Later

Skip Redis until the scrape is slow, flaky, rate-limited, or expensive. Add it once there is a measured reason to cache generated feeds.
