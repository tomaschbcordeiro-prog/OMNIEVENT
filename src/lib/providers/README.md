# Data providers

Each source is an adapter implementing `ProviderAdapter` (`types.ts`): `sync()` returns normalised
events, venues, participants and ticket offers plus a sync-run record. Adapters handle their own
pagination, rate limits and category mapping. UI code never imports an adapter.

| Adapter | Status | Needs |
|---|---|---|
| `demo` | Active when no real provider is configured | nothing |
| `ticketmaster` | Implemented, unit-tested against fixtures; **not yet verified against the live API** | `TICKETMASTER_API_KEY` |

## Adding a provider

1. Create `src/lib/providers/<name>.ts` exporting a `ProviderAdapter`.
2. Map external categories to slugs in `src/lib/categories.ts` (add new categories there if needed).
3. Never guess: skip records without coordinates or start times; leave `feesIncluded`/`totalPrice`
   undefined unless the source states them; keep `externalId` and `sourceUrl`.
4. Register it in `registry.ts`. Add fixture tests in `tests/`.

## Candidate sources (verify terms, licensing and coverage before building)

- **SeatGeek Platform API** (client id; US-focused events + ticket links)
- **Eventbrite API** (public search was removed in 2020; only organisation/venue-scoped fetches)
- **Bandsintown / Songkick** (artist-scoped; partner approval required)
- Sports schedule providers with ticketing partnerships (commercial licences)
- Museum / attraction booking platforms (partner programmes)
- Official organiser and venue feeds (iCal, schema.org Event markup with permission)

Scraping sites against their terms, or bypassing access controls, is out of scope.

## Live currency rates

`src/lib/currency.ts` ships static approximate rates labelled as such. To go live, replace
`PER_USD` with a cached fetch from a licensed FX API and update `FX_SOURCE` (name, timestamp, live: true).
