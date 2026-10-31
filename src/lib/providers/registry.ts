import { demoProvider } from "./demo";
import { lisbonProvider } from "./lisbon";
import { venueCalendarsProvider } from "./venue-calendars";
import { footballProvider } from "./football";
import { bolProvider } from "./bol";
import { cataloniaProvider } from "./catalonia";
import { euskadiProvider } from "./euskadi";
import { castillaLeonProvider } from "./castilla-leon";
import { culturaPortugalProvider } from "./cultura-portugal";
import { openAgendaProvider } from "./openagenda";
import { nycParksProvider } from "./nyc-parks";
import { zaragozaProvider } from "./zaragoza";
import { espooProvider, helsinkiProvider } from "./helsinki";
import { taiwanProvider } from "./taiwan";
import { montrealProvider } from "./montreal";
import { berlinProvider } from "./berlin";
import { barcelonaProvider } from "./barcelona";
import { chicagoProvider } from "./chicago";
import { brisbaneProvider } from "./brisbane";
import { localistProvider } from "./localist";
import { liveWhaleProvider } from "./livewhale";
import { mapasCulturaisProvider } from "./mapas-culturais";
import { wikidataProvider } from "./wikidata";
import { ptMunicipiosProvider } from "./pt-municipios";
import { valenciaIvcProvider } from "./valencia-ivc";
import { madridProvider } from "./madrid";
import { parisProvider } from "./paris";
import { seatgeekProvider } from "./seatgeek";
import { skiddleProvider } from "./skiddle";
import { ticketmasterProvider } from "./ticketmaster";
import type { ProviderAdapter } from "./types";

/**
 * Register new sources here. Each adapter is independent; the store merges and
 * de-duplicates their output. See src/lib/providers/README.md.
 */
export const ALL_PROVIDERS: ProviderAdapter[] = [ticketmasterProvider, seatgeekProvider, skiddleProvider, lisbonProvider, venueCalendarsProvider, bolProvider, culturaPortugalProvider, ptMunicipiosProvider, cataloniaProvider, barcelonaProvider, valenciaIvcProvider, euskadiProvider, castillaLeonProvider, zaragozaProvider, footballProvider, parisProvider, openAgendaProvider, nycParksProvider, chicagoProvider, localistProvider, liveWhaleProvider, mapasCulturaisProvider, helsinkiProvider, espooProvider, taiwanProvider, montrealProvider, brisbaneProvider, berlinProvider, madridProvider, wikidataProvider, demoProvider];

/** DISABLED_PROVIDERS=paris,madrid switches sources off without a code change. */
const disabled = () => new Set((process.env.DISABLED_PROVIDERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

/**
 * Demo data policy:
 *   DEMO_MODE=on    → always include demo data (labelled)
 *   DEMO_MODE=off   → never include demo data
 *   (unset)/auto    → include demo data only when no real provider is configured
 */
export function activeProviders(): ProviderAdapter[] {
  const off = disabled();
  const real = ALL_PROVIDERS.filter((p) => !p.isDemo && p.isConfigured() && !off.has(p.id));
  const mode = (process.env.DEMO_MODE ?? "auto").toLowerCase();
  const includeDemo = mode === "on" || (mode !== "off" && real.length === 0);
  return [...real, ...(includeDemo ? ALL_PROVIDERS.filter((p) => p.isDemo) : [])];
}
