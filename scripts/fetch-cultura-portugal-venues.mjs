// Locates the venues of culturaportugal.gov.pt events (the feed's own coordinates are a
// placeholder). Each town is found first; a venue is kept only within 15 km of its town and
// sharing a significant word with the result. Run: node scripts/fetch-cultura-portugal-venues.mjs
import { readFileSync, writeFileSync } from "node:fs";

const UA = "OMNIEVENT/1.0 (+https://omnievent.vercel.app)";
const OUT = new URL("../src/lib/providers/data/cultura-portugal-venues.json", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const STOP = new Set(["de", "do", "da", "dos", "das", "e", "o", "a", "os", "as", "em", "no", "na", "sala", "casa", "centro", "museu", "teatro", "biblioteca", "municipal", "nacional", "cultural", "auditorio", "galeria", "palacio", "nucleo", "espaco", "varios", "espacos"]);
const words = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
const km = (a, b, c, d) => {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const text = (h) => (h ?? "").replace(/<[^>]+>/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? "";
const photon = async (q, bias) => {
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6${bias ? `&lat=${bias.lat}&lon=${bias.lng}` : ""}`, { headers: { "User-Agent": UA } });
  await sleep(1000);
  return res.ok ? (await res.json()).features.filter((f) => f.properties.countrycode === "PT") : [];
};

const events = await (await fetch("https://culturaportugal.gov.pt/umbraco/api/eventsapi/GetEvents", { headers: { "User-Agent": UA } })).json();
let table = {};
try {
  table = JSON.parse(readFileSync(OUT, "utf8"));
} catch {
  // first run
}
const towns = table.__towns ?? {};
for (const e of events) {
  const town = (e.Location ?? "").trim();
  const venue = text(e.Where).normalize("NFKC");
  if (!town || !venue) continue;
  const key = `${venue}|${town}`;
  if (key in table) continue;
  if (!(town in towns)) {
    const t = (await photon(`${town}, Portugal`)).find((f) => ["city", "town", "village", "municipality", "administrative"].includes(f.properties.osm_value) || f.properties.type === "city");
    towns[town] = t ? { lat: t.geometry.coordinates[1], lng: t.geometry.coordinates[0] } : null;
  }
  const c = towns[town];
  if (!c) {
    table[key] = null;
    continue;
  }
  // "Lisboa / Faro", "Elvas (vários espaços)", "Online": not one place.
  if (/\/|v[aá]ri[oa]s|online/i.test(venue)) {
    table[key] = null;
    continue;
  }
  const want = words(venue);
  const hit = want.length ? (await photon(`${venue}, ${town}`, c)).find((f) => {
    const [lng, lat] = f.geometry.coordinates;
    const got = new Set(words(`${f.properties.name ?? ""} ${f.properties.street ?? ""}`));
    return km(c.lat, c.lng, lat, lng) < 15 && want.some((w) => got.has(w));
  }) : undefined;
  table[key] = hit ? { lat: +hit.geometry.coordinates[1].toFixed(6), lng: +hit.geometry.coordinates[0].toFixed(6) } : null;
  console.log(hit ? "located" : "not located", key);
}
table.__towns = towns;
writeFileSync(OUT, JSON.stringify(table, null, 0).replace(/,"/g, ',\n"') + "\n");
