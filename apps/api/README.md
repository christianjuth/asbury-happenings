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
```

Plain-text debug output:

```bash
curl "http://localhost:3000/calendar/example-events.ics?debug=1"
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
    description: ".description",
    url: { selector: "a.details", attr: "href" }
  }
}
```

Date parsing is forgiving by default for common date shapes like `Jul 02`, `July 2`, `7/2/2026`, and `2026-07-02`. Date selectors can include `format` for site-specific dates:

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

`{year}` and `{month}` use the current UTC year and zero-padded month. Each `containerSelector` match becomes one event. `title` plus either `start` or `startDate` are required; containers missing them are skipped. If no end date/time is found, `defaultDurationMinutes` is used.

## Add Redis Later

Skip Redis until the scrape is slow, flaky, rate-limited, or expensive. Add it once there is a measured reason to cache generated feeds.
