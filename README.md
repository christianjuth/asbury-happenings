# Asbury Happenings

pnpm workspace for the Asbury Happenings API, web application, and shared
development packages.

## Requirements

- Node.js 22 or newer
- pnpm 9.15.0

## Workspace

- `apps/api`: Fastify API
- `apps/web`: Vite and React frontend
- `packages/eslint-config`: shared feature-boundary policy

## Development

Install all workspace dependencies from the repository root:

```bash
pnpm install
```

Run both applications:

```bash
pnpm dev
```

Or run either application separately:

```bash
pnpm dev:api
pnpm dev:web
```

The web app defaults to `http://localhost:3100` and the API defaults to
`http://localhost:3101`. Set `VITE_API_URL` in `apps/web/.env` and `WEB_ORIGIN`
in `apps/api/.env` when using different origins.

## Checks

```bash
pnpm lint
pnpm lint:dead
pnpm test:ts
pnpm test
pnpm build
```

`pnpm format` writes Prettier changes across the workspace.

## Frontend Structure

Routes and top-level composition belong in `apps/web/src/app`. Domain code and
colocated tests belong in `apps/web/src/features`, while reusable UI,
configuration, and infrastructure live in `components`, `config`, and `lib`.
Use the `@/*` alias for imports from `apps/web/src`.

Cross-feature imports require a directed edge in
`apps/web/feature-boundaries.config.mjs`. Both apps enforce feature boundaries
with `@repo/eslint-config` and use Knip for dead-code analysis.
