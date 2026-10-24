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

## The map

One MapLibre GL engine renders both views from the same camera, so switching keeps your place:

- **3D**: a globe with atmosphere, a live day/night terminator (three twilight bands computed from the sun's real position), 3D terrain and tilt/rotate.
- **2D**: Web Mercator street map.
- **Styles**: *Satellite* (real imagery with roads, borders and labels on top) or *Map* (a clean dark street map). Layer toggles: events, event density, place names, roads, borders, points of interest, 3D buildings, terrain, day/night.
- **Detail on demand**: tiles stream in for the current view only, getting sharper as you zoom; 3D buildings appear from zoom 14 where OpenStreetMap has them.
- **Click anything**: event clusters open their events; country/city/street/building labels fly there; any other point is identified by reverse geocoding (street → neighbourhood → city → country, each one-click to fly to).
- **Place search**: addresses, streets, postcodes, landmarks, cities and "lat, lng" in the main search box; ambiguous names list every match with context.
- Shareable view links (`?at=lat,lng,zoom,bearing,pitch&pin=lat,lng`), previous-view history, full screen, reduced-motion support, WebGL-loss recovery.

| Data | Without keys (default) | With `NEXT_PUBLIC_MAPTILER_KEY` |
|---|---|---|
| Satellite imagery | Sentinel-2 cloudless 2016 by EOX (CC BY 4.0, ≈10 m/pixel, sharp to city scale) | MapTiler Satellite (sub-metre in many cities) |
| Streets, buildings, labels | OpenFreeMap (OpenStreetMap, OpenMapTiles schema) | same |
| Terrain | AWS Open Data Terrain Tiles (Mapzen) | MapTiler Terrain RGB |
| Place search | Photon by Komoot (OpenStreetMap, fair use) | MapTiler Geocoding |

Not included (would need separate providers and licences): photorealistic 3D city meshes (e.g. Google Photorealistic 3D Tiles via Cesium) and street-level photography.

## Search: area, radius and local time

One search model (`SearchFilters`, encoded by `src/lib/search/params.ts`) drives the map markers, the result lists and every page.

- **Pick an area anywhere**: "Explore an area" then click the map, "Explore events here" on any clicked place, a searched address, or your location (asked only when you press the button). The pin is draggable; the circle is geodesic (exact great-circle distance, correct at high latitudes and across ±180°). Radius 0.5–2,000 km with presets and a log-scale slider.
- **Local dates and times**: a window such as 24 Oct, 18:00–23:00 is wall-clock time *at each venue* (IANA zones, never fixed offsets or the browser's zone). An event matches when any of its scheduled intervals (main run or repeat performances) overlaps the window. Overnight windows (22:00–04:00) run into the next day. DST: repeated hours widen the window (earliest start, latest end); missing hours move to the first valid instant. Events without an end are assumed to last their stated duration, else two hours. Daily attractions match on their daily opening hours. Online-only events never match a physical radius.
- **The pin's time zone** comes from `/api/timezone` (offline boundary data, `@photostructure/tz-lookup`) and is shown with its offset on the chosen date.
- **Across pages**: URLs carry the search (`lat,lng,radius,pl,from,to,tfrom,tto,cat,…`), "Full list" and "Show on map" switch views, and Events / Categories / Destinations offer to continue the last search (kept for the browser tab). Saved searches live in My World (stored in this browser until accounts exist).

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

Providers are adapters (`src/lib/providers/`). The store re-syncs each provider on its refresh interval (stale-while-revalidate), and `/api/sync` lets a scheduler force a run (`vercel.json` runs it daily, the limit on Vercel's free Hobby plan; the store also refreshes stale providers on incoming requests).

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
| 3D globe and 2D map (MapLibre), satellite/map styles, terrain, 3D buildings, day/night, place search and reverse geocoding, clustering, list view, all pages, ticket comparison, trip planner, calendar | Working, tested |
| Satellite detail | Free imagery is ≈10 m/pixel (city scale). Street-level satellite detail needs a MapTiler key |
| Event data | **Fictional demo data** until a provider key is set. Every demo item carries a Demo badge and is `noindex` |
| Ticketmaster adapter | Implemented and unit-tested against fixtures; **not yet run against the live API** (no key in the build environment) |
| Ticket purchase | Links out to sellers. No checkout, no payments, no purchase confirmation |
| Accounts | Not configured. My World is stored in the browser (labelled demo mode); Supabase Auth is the intended integration |
| Alerts | Preferences are saved; **nothing is sent** (no email/push service connected) |
| Currency conversion | Static approximate rates, labelled as estimates |
| Translations | Navigation and category labels in EN/PT/ES/FR/DE; page body copy is English |
| Database | In-memory; Postgres schema provided but not wired |
