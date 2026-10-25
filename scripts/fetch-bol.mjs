// Saves a snapshot of BOL's listings (schema.org Event data on each category page) and
// locates venues the listings give no coordinates for, from their street address and
// postcode. Run: node scripts/fetch-bol.mjs
import { readFileSync, writeFileSync } from "node:fs";

const UA = "OMNIEVENT/1.0 (+https://omnievent.vercel.app)";
const OUT = new URL("../src/lib/providers/data/bol-events.json", import.meta.url);
const VENUES = new URL("../src/lib/providers/data/bol-venues.json", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const slim = (d, bolCategory) => ({
  productID: d.productID,
  name: d.name,
  url: d.url,
  image: d.image,
  startDate: d.startDate,
  endDate: d.endDate,
  duration: d.duration,
  location: d.location && {
    name: d.location.name,
    url: d.location.url,
    geo: d.location.geo && { latitude: d.location.geo.latitude, longitude: d.location.geo.longitude },
    address: d.location.address && {
      streetAddress: d.location.address.streetAddress,
      postalCode: d.location.address.postalCode,
      addressLocality: d.location.address.addressLocality,
    },
  },
  offers: d.offers && { availability: d.offers.availability, url: d.offers.url, price: d.offers.price, priceCurrency: d.offers.priceCurrency },
  bolCategory,
});

const events = new Map();
for (const cat of [1, 2, 3, 4, 5]) {
  const res = await fetch(`https://www.bol.pt/Comprar/pesquisa/${cat}-0-0-0-0-0/bilhetes`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`category ${cat}: HTTP ${res.status}`);
  const html = await res.text();
  let n = 0;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]);
      if (d["@type"] === "Event" && d.productID && !events.has(d.productID)) {
        events.set(d.productID, slim(d, cat));
        n++;
      }
    } catch {
      // skip
    }
  }
  console.log("category", cat, n);
  await sleep(1000);
}

// Venues without usable coordinates: look them up once, keep only confident matches.
const table = JSON.parse(readFileSync(VENUES, "utf8"));
const hasGeo = (l) => {
  const lat = Number(l?.geo?.latitude);
  const lng = Number(l?.geo?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0;
};
const missing = new Map();
for (const e of events.values()) if (e.location?.url && !hasGeo(e.location) && !table[e.location.url]) missing.set(e.location.url, e.location);

const GENERIC = /^(outros locais|v[aá]rios locais|online|a definir|local a definir)$/i;
for (const [url, loc] of missing) {
  const a = loc.address ?? {};
  if (GENERIC.test(loc.name ?? "") || !a.postalCode || a.postalCode.endsWith("-000")) continue;
  const q = [a.streetAddress && a.streetAddress !== "-" ? a.streetAddress : loc.name, a.postalCode, "Portugal"].join(", ");
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=3&lang=default`, { headers: { "User-Agent": UA } });
  const json = res.ok ? await res.json() : { features: [] };
  // Accept only a result in Portugal whose postcode shares the first four digits.
  const hit = json.features.find((f) => f.properties.countrycode === "PT" && (f.properties.postcode ?? "").slice(0, 4) === a.postalCode.slice(0, 4));
  if (hit) {
    const [lng, lat] = hit.geometry.coordinates;
    table[url] = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
    console.log("located", loc.name, a.postalCode, table[url]);
  } else console.log("not located", loc.name, q);
  await sleep(1100);
}

writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), events: [...events.values()] }) + "\n");
writeFileSync(VENUES, JSON.stringify(table, null, 1) + "\n");
console.log("saved", events.size, "events,", Object.keys(table).length, "located venues");
