# Data providers

Each source is an adapter implementing `ProviderAdapter` (`types.ts`): `sync()` returns normalised
events, venues, participants and ticket offers plus a sync-run record. Adapters handle their own
pagination, rate limits and category mapping. UI code never imports an adapter.

| Adapter | Status | Needs |
|---|---|---|
| `demo` | Active only when no real provider is active | nothing |
| `ticketmaster` | Live. City-by-city radius queries, then one page per country | `TICKETMASTER_API_KEY` |
| `paris` | Live. City of Paris "Que faire à Paris", ODbL, paged 100 at a time | nothing |
| `madrid` | Live. City of Madrid cultural agenda, next 100 days | nothing |
| `seatgeek` | Fixture-tested; on when the key is set | `SEATGEEK_CLIENT_ID` |
| `skiddle` | Fixture-tested; on when the key is set | `SKIDDLE_API_KEY` |

Shared helpers (retrying JSON fetch, local-time parsing, price text, nearest city) live in `common.ts`.
`DISABLED_PROVIDERS=id1,id2` switches adapters off without a code change.

## Adding a provider

1. Create `src/lib/providers/<name>.ts` exporting a `ProviderAdapter`.
2. Map external categories to slugs in `src/lib/categories.ts` (add new categories there if needed).
3. Never guess: skip records without coordinates or start times; leave `feesIncluded`/`totalPrice`
   undefined unless the source states them; keep `externalId` and `sourceUrl`.
4. Register it in `registry.ts`. Add fixture tests in `tests/`.

## Candidate sources (verify terms, licensing and coverage before building)

- **OpenAgenda** (free key; thousands of French and European agendas)
- More city open-data agendas (Barcelona, Lisbon, Berlin…), once their feeds are confirmed stable
- **Eventbrite API** (public search was removed in 2020; only organisation/venue-scoped fetches)
- **Bandsintown / Songkick** (artist-scoped; partner approval required)
- Sports schedule providers with ticketing partnerships (commercial licences)
- Museum / attraction booking platforms (partner programmes)
- Official organiser and venue feeds (iCal, schema.org Event markup with permission)

Scraping sites against their terms, or bypassing access controls, is out of scope.

## Live currency rates

`src/lib/currency.ts` ships static approximate rates labelled as such. To go live, replace
`PER_USD` with a cached fetch from a licensed FX API and update `FX_SOURCE` (name, timestamp, live: true).
