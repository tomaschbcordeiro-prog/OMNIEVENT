# OMNIEVENT

Discover events anywhere on Earth on an interactive 3D globe: concerts, sport, theatre, festivals, conferences, exhibitions, attractions and more. Compare ticket options and go straight to the official seller.

> **Status: working MVP with real events.** Real listings come from Ticketmaster (key), the City of Paris and the City of Madrid (open data, no key), and optionally SeatGeek and Skiddle (free keys). Clearly labelled **fictional** demo data is used only if every real source is switched off. See [What's real and what isn't](#whats-real-and-what-isnt).

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

**Sources:**

| Source | Coverage | Needs |
|---|---|---|
| Ticketmaster Discovery API | Full catalogue in ~50 countries, up to 2 years ahead, read in date windows under the 1,000-results-per-query limit | `TICKETMASTER_API_KEY` |
| SeatGeek Platform API | US and Canadian cities, live marketplace prices | `SEATGEEK_CLIENT_ID` (free, <https://seatgeek.com/account/develop>) |
| Skiddle Events API | UK and Ireland: clubs, gigs, festivals, comedy | `SKIDDLE_API_KEY` (free, <https://www.skiddle.com/api/join.php>) |
| Agenda Cultural de Lisboa (agendalx.pt API) | City of Lisbon cultural agenda, CC BY 4.0; ~400 mapped events | nothing |
| Lisbon venue calendars (CCB, Chapitô) | Each venue's full public programme (The Events Calendar REST API) | nothing |
| BOL (bol.pt) | Theatre, concerts, museums, festivals and family shows sold through BOL across Portugal and the islands, with venue coordinates, prices and availability | nothing |
| Agenda Cultural de Catalunya | Cultural activities across Catalonia (open data, coordinates, prices, ticket links) | nothing |
| Kulturklik (Basque Country, Navarre) | Concerts, theatre, talks, films, exhibitions; venues located by name, otherwise town centre (labelled) | nothing |
| Castilla y León agenda | Geolocated cultural activities, including village libraries | nothing |
| Cultura Portugal (culturaportugal.gov.pt) | Exhibitions, concerts and talks at national museums, monuments and theatres | nothing |
| OpenAgenda (France and neighbours) | Events published by French towns, villages, libraries, museums and festivals, with coordinates | nothing |
| NYC Parks events | Free concerts, tours, films and kids' activities in New York parks | nothing |
| Zaragoza city agenda | Museums, theatres, civic centres and festivals in Zaragoza | nothing |
| Helsinki Linked Events | Concerts, theatre, exhibitions, library and family events in the Helsinki region | nothing |
| Taiwan Ministry of Culture | Concerts, theatre, dance, exhibitions and talks across Taiwan | nothing |
| Ville de Montréal | Public events in Montréal libraries, cultural centres and parks | nothing |
| kulturdaten.berlin | Cultural events across Berlin's districts | nothing |
| Ajuntament de Barcelona | Barcelona's cultural and sports agenda | nothing |
| football-data.org | Every scheduled match of 12 competitions (Premier League, Championship, LaLiga, Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga, Brasileirão, Champions League, World Cup, Euros) at 185 hand-checked stadiums; a snapshot is shown until the key is set | `FOOTBALL_DATA_KEY` (free, <https://www.football-data.org/client/register>) for live updates |
| Que faire à Paris (opendata.paris.fr) | City of Paris listings, ODbL | nothing |
| Madrid cultural agenda (datos.madrid.es) | Municipal activities for the next 100 days | nothing |

Set keys in `.env.local` (or your host's env vars) and restart; each source switches on when its key is present. `DISABLED_PROVIDERS=paris,madrid` switches sources off. Demo data appears only when no real source is active (`DEMO_MODE=auto`). Listings that give dates but no times are flagged `hoursUnknown`: they show without a time and are left out of time-of-day searches.

**Ticket comparison.** Most sellers (BOL, Ticketline, MEO Blueticket, StubHub, Vivid Seats, AXS, See Tickets, Eventim, TicketOne, Fnac Spectacles, Eventbrite…) publish no open data feed, so their prices can't be read. Event pages and previews link to each seller's own search for the event in that country, labelled as not checked by us (`src/lib/sellers.ts`). Real price comparison across them needs partner/affiliate access from each seller.

More sources: see `src/lib/providers/README.md`. No single API covers every event in the world, and coverage grows one licensed source at a time.

## Environment variables

See `.env.example`. None are required. `TICKETMASTER_API_KEY`, `SEATGEEK_CLIENT_ID` and `SKIDDLE_API_KEY` enable those sources; `CRON_SECRET` enables scheduled sync; `NEXT_PUBLIC_SITE_URL` sets canonical URLs.

## Database

Runs in memory today. The production schema (PostgreSQL + PostGIS, Supabase-compatible, with row-level security) is in `db/migrations/0001_init.sql`; see `db/README.md`.

## Tests

```bash
npm test                                   # 72 unit tests: parser, geo, time, provider mapping, store queries
npm run build                              # then:
DISABLED_PROVIDERS=paris,madrid,lisbon,venue-calendars,football,bol,catalonia,euskadi,castilla-leon,cultura-portugal,openagenda,nyc-parks,zaragoza,helsinki,taiwan,montreal,berlin,barcelona npm start  # e2e flows expect demo data
node tests/e2e/smoke.mjs                   # 21 end-to-end browser flows (Playwright)
```

## What's real and what isn't

| Area | State |
|---|---|
| 3D globe and 2D map (MapLibre), satellite/map styles, terrain, 3D buildings, day/night, place search and reverse geocoding, clustering, list view, all pages, ticket comparison, trip planner, calendar | Working, tested |
| Satellite detail | Free imagery is ≈10 m/pixel (city scale). Street-level satellite detail needs a MapTiler key |
| Event data | Real, from the sources above. Fictional demo data (Demo badge, `noindex`) only when every real source is off |
| Ticketmaster, Paris, Madrid adapters | Running against the live sources |
| SeatGeek, Skiddle adapters | Implemented and unit-tested against fixtures; switch on when their keys are set |
| Ticket purchase | Links out to sellers. No checkout, no payments, no purchase confirmation |
| Accounts | Not configured. My World is stored in the browser (labelled demo mode); Supabase Auth is the intended integration |
| Alerts | Preferences are saved; **nothing is sent** (no email/push service connected) |
| Currency conversion | Static approximate rates, labelled as estimates |
| Translations | Navigation and category labels in EN/PT/ES/FR/DE; page body copy is English |
| Database | In-memory; Postgres schema provided but not wired |
