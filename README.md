# OMNIEVENT

Discover events anywhere on Earth on an interactive 3D globe: concerts, sport, theatre, festivals, conferences, exhibitions, attractions and more. Compare ticket options and go straight to the official seller.

> **Status: working MVP in demo mode.** With no API keys, the app runs on clearly labelled **fictional** demo data (about 3,000 events in 84 real cities). Add a Ticketmaster key to load real events. See [What's real and what isn't](#whats-real-and-what-isnt).

## Quick start

```bash
npm install
cp .env.example .env.local      # optional; works with no keys
npm run dev                     # http://localhost:3000
```

Production: `npm run build && npm start`.

## Pages

| Route | What it does |
|---|---|
| `/` | 3D globe (WebGL), 2D map and list views, natural-language search, globe modes, filters, density view, cluster and event previews, discovery panels |
| `/events`, `/events/[slug]` | Full search with URL-encoded filters, list/grid, sorting, pagination; event detail with ticket comparison, map, line-up, status, provenance, .ics export |
| `/categories`, `/categories/[slug]` | Category index; shared category template with subcategories, map, top cities, sports fixtures table |
| `/destinations`, `/destinations/[slug]` | Continent / country / city pages with trip-date filter, per-day calendar, venues, highlights |
| `/participants/[slug]`, `/venues/[slug]` | Artist / team / speaker and venue profiles |
| `/my-world` | Saved events, calendar with clash detection, multi-city trip planner (.ics export), follows, alert preferences, onboarding, data export/delete |
| `/search?q=…` | Parses natural language and redirects to a shareable `/events` URL |
| `/about/data` | Live data-source status and coverage statement |

## API

All validated with zod; errors are `{ error: { code, message, details? } }`.

`GET /api/events` (filters + pagination) · `GET /api/events/:slug` · `GET /api/events/:slug/ics` · `GET /api/events/batch?ids=` · `GET /api/geo` (viewport clustering: `vlat`, `vlng`, `vr`, `cell`) · `GET /api/search/parse?q=` · `GET /api/search/suggest?q=` · `GET /api/categories` · `GET /api/destinations` · `GET /api/providers` · `GET|POST /api/sync` (cron, `Authorization: Bearer $CRON_SECRET`) · `GET /out/:offerId` (safe outbound ticket redirect; no open redirect).

Filter params: `q, cat, from, to, city, country, continent, lat, lng, radius, min, max, cur, status, access, family, online, accessible, indoor, participant, venue, sport, competition, source, sort, page, size`.

## Automatic updates and real data

Providers are adapters (`src/lib/providers/`). The store re-syncs each provider on its refresh interval (stale-while-revalidate), and `/api/sync` lets a scheduler force a run (`vercel.json` runs it hourly on Vercel).

**Enable real events:**
1. Get a free key at <https://developer.ticketmaster.com>.
2. Set `TICKETMASTER_API_KEY` in `.env.local` (or your host's env vars).
3. Restart. Demo data switches off automatically (`DEMO_MODE=auto`), and real events, venues and ticket links load and refresh every 60 minutes.

More sources: see `src/lib/providers/README.md`. No single API covers every event in the world, and coverage grows one licensed source at a time.

## Environment variables

See `.env.example`. None are required. `TICKETMASTER_API_KEY` enables real data; `CRON_SECRET` enables scheduled sync; `NEXT_PUBLIC_SITE_URL` sets canonical URLs.

## Database

Runs in memory today. The production schema (PostgreSQL + PostGIS, Supabase-compatible, with row-level security) is in `db/migrations/0001_init.sql`; see `db/README.md`.

## Tests

```bash
npm test                                   # 31 unit tests: parser, geo, provider mapping, store queries
npm run build && npm start &               # then:
node tests/e2e/smoke.mjs                   # 11 end-to-end browser flows (Playwright)
```

## What's real and what isn't

| Area | State |
|---|---|
| 3D globe, clustering, map/list views, search, filters, all pages, ticket comparison UI, trip planner, calendar | Working, tested |
| Event data | **Fictional demo data** until a provider key is set. Every demo item carries a Demo badge and is `noindex` |
| Ticketmaster adapter | Implemented and unit-tested against fixtures; **not yet run against the live API** (no key in the build environment) |
| Ticket purchase | Links out to sellers. No checkout, no payments, no purchase confirmation |
| Accounts | Not configured. My World is stored in the browser (labelled demo mode); Supabase Auth is the intended integration |
| Alerts | Preferences are saved; **nothing is sent** (no email/push service connected) |
| Currency conversion | Static approximate rates, labelled as estimates |
| Translations | Navigation and category labels in EN/PT/ES/FR/DE; page body copy is English |
| Database | In-memory; Postgres schema provided but not wired |
