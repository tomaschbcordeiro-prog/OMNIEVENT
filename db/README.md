# Database

The app currently runs on an in-memory store (`src/lib/store.ts`) so it works with zero infrastructure.
`migrations/0001_init.sql` is the production schema (PostgreSQL + PostGIS, Supabase-compatible, with row-level security on all user-owned tables).

Setup:

```bash
# Supabase: create a project, then
psql "$DATABASE_URL" -f db/migrations/0001_init.sql
```

Seeding: categories and destinations come from `src/lib/categories.ts` and `src/lib/destinations.ts`; events, venues, participants and offers are written by provider syncs (`/api/sync`). Demo data is never written to a production database.

Geographic queries use `ST_DWithin(location, ST_MakePoint(lng, lat)::geography, radius_m)` and clustering can use `ST_SnapToGrid` or `ST_ClusterKMeans` server-side.

Migrating the store: implement the read functions in `src/lib/store.ts` (`searchEvents`, `clusterEvents`, `getEventView`, …) as SQL queries against these tables. The function signatures are what the API routes and pages depend on.
