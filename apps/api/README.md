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

Calendar feed stub:

```bash
curl "http://localhost:3000/calendar/webpage.ics?url=https://example.com"
```

## Docker

Build and run app:

```bash
docker compose up --build
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

`GET /calendar/webpage.ics?url=https://example.com`

Current implementation fetches a page, uses its `<title>` as a placeholder event title, and returns a valid `.ics` response. Replace `extractEventsFromHtml` in `src/calendar/calendar.service.ts` with site-specific scraping logic.

## Add Redis Later

Skip Redis until the scrape is slow, flaky, rate-limited, or expensive. Add it once there is a measured reason to cache generated feeds.
