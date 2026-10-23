-- OMNIEVENT core schema (PostgreSQL 15+ with PostGIS).
-- Mirrors src/lib/types.ts. Apply with: psql "$DATABASE_URL" -f db/migrations/0001_init.sql
-- On Supabase: paste into the SQL editor or use `supabase db push`.

create extension if not exists postgis;
create extension if not exists pg_trgm;   -- fuzzy text search
create extension if not exists unaccent;

-- ---------------------------------------------------------------- reference
create table if not exists categories (
  slug          text primary key,
  name          text not null,
  parent_slug   text references categories(slug) on delete set null,  -- unlimited depth
  icon          text,
  description   text,
  display_order int  not null default 0,
  active        boolean not null default true
);

create table if not exists destinations (
  id            text primary key,                       -- e.g. 'lisbon', 'pt', 'europe'
  slug          text unique not null,
  name          text not null,
  kind          text not null check (kind in ('continent','country','region','city','district')),
  parent_id     text references destinations(id),
  country_code  char(2),
  time_zone     text,
  currency      char(3),
  location      geography(Point, 4326) not null,
  aliases       text[] not null default '{}'
);
create index if not exists destinations_loc_gix on destinations using gist (location);

create table if not exists providers (
  id            text primary key,                        -- 'ticketmaster', 'demo', …
  name          text not null,
  is_demo       boolean not null default false,
  coverage      text,
  attribution   text
);

-- ---------------------------------------------------------------- core
create table if not exists venues (
  id            text primary key,
  slug          text unique not null,
  name          text not null,
  address       text,
  city          text not null,
  city_id       text references destinations(id),
  region        text,
  country       text not null,
  country_code  char(2) not null,
  location      geography(Point, 4326) not null,
  time_zone     text not null,
  venue_type    text,
  indoor        boolean,
  capacity      int check (capacity is null or capacity > 0),
  url           text,
  accessibility text[],
  provider      text not null references providers(id),
  external_id   text not null,
  is_demo       boolean not null default false,
  last_synced_at timestamptz not null,
  unique (provider, external_id)
);
create index if not exists venues_loc_gix on venues using gist (location);
create index if not exists venues_city_idx on venues (city_id);

create table if not exists participants (
  id            text primary key,
  slug          text unique not null,
  name          text not null,
  kind          text not null check (kind in ('artist','team','athlete','speaker','performer','organizer','production','competition')),
  description   text,
  image_url     text,
  country       text,
  url           text,
  provider      text not null references providers(id),
  external_id   text not null,
  is_demo       boolean not null default false,
  last_synced_at timestamptz not null,
  unique (provider, external_id)
);
create index if not exists participants_name_trgm on participants using gin (name gin_trgm_ops);

create table if not exists events (
  id               text primary key,
  canonical_id     text not null references events(id) deferrable initially deferred,
  slug             text unique not null,
  title            text not null,
  description      text,
  category_slug    text not null references categories(slug),
  group_slug       text not null references categories(slug),
  event_type       text not null check (event_type in ('single','recurring','multi_day','daily_attraction')),
  venue_id         text not null references venues(id),
  starts_at        timestamptz not null,           -- stored in UTC …
  ends_at          timestamptz,
  time_zone        text not null,                  -- … with the venue's IANA zone preserved
  duration_minutes int,
  status           text not null check (status in ('scheduled','on_sale','sold_out','postponed','rescheduled','cancelled','completed','free_entry','registration_required','unknown')),
  status_note      text,
  rescheduled_from timestamptz,
  ticket_access    text not null check (ticket_access in ('ticketed','free','registration','invitation_only','unknown')),
  is_free          boolean not null default false,
  registration_required boolean not null default false,
  online           boolean not null default false,
  family_friendly  boolean not null default false,
  min_age          int,
  guardian_required_under int,
  age_note         text,
  accessibility    text[],
  official_url     text,
  image_url        text,
  sports           jsonb,                          -- { sport, competition, league, stage, season }
  schedule         timestamptz[],
  time_slots       jsonb,
  announced_at     timestamptz,
  sponsored        boolean not null default false, -- paid placement is always labelled
  provider         text not null references providers(id),
  external_id      text not null,
  source_url       text,
  is_demo          boolean not null default false,
  completeness     real,
  last_synced_at   timestamptz not null,
  last_verified_at timestamptz,
  search           tsvector generated always as (to_tsvector('simple', unaccent(coalesce(title,'') || ' ' || coalesce(description,'')))) stored,
  unique (provider, external_id)
);
create index if not exists events_start_idx    on events (starts_at);
create index if not exists events_group_idx    on events (group_slug, starts_at);
create index if not exists events_cat_idx      on events (category_slug, starts_at);
create index if not exists events_venue_idx    on events (venue_id, starts_at);
create index if not exists events_status_idx   on events (status);
create index if not exists events_search_gin   on events using gin (search);
create index if not exists events_title_trgm   on events using gin (title gin_trgm_ops);
-- Conservative duplicate detection key (see src/lib/store.ts rebuildIndexes).
create index if not exists events_dedupe_idx on events (lower(title), venue_id, date_trunc('hour', starts_at));

create table if not exists event_participants (
  event_id       text not null references events(id) on delete cascade,
  participant_id text not null references participants(id) on delete cascade,
  role           text not null,
  sort_order     int not null default 0,
  primary key (event_id, participant_id, role)
);
create index if not exists event_participants_p_idx on event_participants (participant_id);

create table if not exists ticket_offers (
  id                 text primary key,
  event_id           text not null references events(id) on delete cascade,
  provider_name      text not null,
  provider_type      text not null check (provider_type in ('primary','official_resale','box_office','organizer','marketplace')),
  provider_event_id  text,
  ticket_category    text not null,
  label              text,
  base_price         numeric(12,2) check (base_price is null or base_price >= 0),
  max_price          numeric(12,2),
  fee_amount         numeric(12,2),
  total_price        numeric(12,2),             -- only when verified by the seller
  fees_included      boolean,                   -- null = unknown
  currency           char(3) not null check (currency ~ '^[A-Z]{3}$'),
  availability       text not null check (availability in ('available','limited','sold_out','not_on_sale','unknown')),
  purchase_url       text check (purchase_url is null or purchase_url ~ '^https://'),
  price_observed_at  timestamptz,
  availability_verified_at timestamptz,
  sponsored          boolean not null default false,
  source_metadata    jsonb,
  is_demo            boolean not null default false
);
create index if not exists ticket_offers_event_idx on ticket_offers (event_id);

-- ---------------------------------------------------------------- sync bookkeeping
create table if not exists sync_runs (
  run_id        text primary key,
  provider      text not null references providers(id),
  started_at    timestamptz not null,
  finished_at   timestamptz,
  imported      int not null default 0,
  updated       int not null default 0,
  failures      int not null default 0,
  rate_limited  boolean not null default false,
  ok            boolean not null default false,
  error         text
);
create index if not exists sync_runs_provider_idx on sync_runs (provider, started_at desc);

-- ---------------------------------------------------------------- user-owned data (Supabase auth.users)
create table if not exists user_preferences (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  language       text not null default 'en',
  currency       char(3) not null default 'EUR',
  home_city_id   text references destinations(id),
  interests      text[] not null default '{}',
  budget         numeric(12,2),
  travel         text,
  notifications  jsonb not null default '{}',
  share_usage    boolean not null default false,
  updated_at     timestamptz not null default now()
);

create table if not exists saved_items (
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('event','participant','venue','destination','competition','category')),
  item_id    text not null,
  name       text,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, item_id)
);

create table if not exists trips (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (length(name) between 1 and 120),
  starts_on  date,
  ends_on    date check (ends_on is null or starts_on is null or ends_on >= starts_on),
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists trip_events (
  trip_id  uuid not null references trips(id) on delete cascade,
  event_id text not null,
  added_at timestamptz not null default now(),
  primary key (trip_id, event_id)
);

-- Row-level security: users can only ever see and change their own rows.
alter table user_preferences enable row level security;
alter table saved_items      enable row level security;
alter table trips            enable row level security;
alter table trip_events      enable row level security;

create policy "own prefs"  on user_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own saved"  on saved_items      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own trips"  on trips            for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own trip events" on trip_events for all
  using (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()))
  with check (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()));

-- Public catalogue tables are read-only to clients; writes happen server-side with the service role.
alter table events enable row level security;
alter table venues enable row level security;
alter table participants enable row level security;
alter table ticket_offers enable row level security;
alter table event_participants enable row level security;
create policy "public read events" on events for select using (true);
create policy "public read venues" on venues for select using (true);
create policy "public read participants" on participants for select using (true);
create policy "public read offers" on ticket_offers for select using (true);
create policy "public read ep" on event_participants for select using (true);

-- Retention: purge events that ended more than 180 days ago (run from the sync job).
-- delete from events where coalesce(ends_at, starts_at) < now() - interval '180 days';
