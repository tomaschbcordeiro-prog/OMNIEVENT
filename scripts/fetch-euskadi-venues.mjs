// Locates the venues ("establishments") named in the Basque Government's culture agenda,
// which only publishes each town's centre. Keeps a result only when it lies within 8 km of
// the town centre and shares a significant word with the venue's name.
// Run: node scripts/fetch-euskadi-venues.mjs   (re-run to add venues that appeared since)
import { readFileSync, writeFileSync } from "node:fs";

const UA = "OMNIEVENT/1.0 (+https://omnievent.vercel.app)";
const OUT = new URL("../src/lib/providers/data/euskadi-venues.json", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const STOP = new Set(["de", "del", "la", "el", "los", "las", "y", "eta", "en", "a", "the", "sala", "casa", "centro", "cultura", "kultur", "etxea", "aretoa", "auditorio", "teatro", "antzokia", "plaza", "iglesia", "museo", "museoa", "zentroa", "centre", "espacio", "biblioteca", "liburutegia", "municipal", "udal", "cultural"]);
const words = (s) => norm(s).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2 && !STOP.has(w));
const km = (a, b, c, d) => {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

const items = [];
for (let page = 1; ; page++) {
  const res = await fetch(`https://api.euskadi.eus/culture/events/v1.0/events/upcoming?_elements=100&_page=${page}`, { headers: { "User-Agent": UA } });
  const json = await res.json();
  items.push(...json.items);
  if (page >= json.totalPages || !json.items.length) break;
}
console.log("events", items.length);

let table = {};
try {
  table = JSON.parse(readFileSync(OUT, "utf8"));
} catch {
  // first run
}
const venues = new Map();
for (const i of items) {
  if (!i.establishmentEs || !i.municipalityLatitude) continue;
  const key = `${i.establishmentEs}|${i.municipalityEs}`;
  if (!(key in table)) venues.set(key, { name: i.establishmentEs, town: i.municipalityEs, lat: +i.municipalityLatitude, lng: +i.municipalityLongitude });
}
console.log("to locate", venues.size);

let found = 0;
for (const [key, v] of venues) {
  const town = v.town.split("/")[0].trim();
  const q = `${v.name}, ${town}`;
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${v.lat}&lon=${v.lng}&limit=5`, { headers: { "User-Agent": UA } });
  const feats = res.ok ? (await res.json()).features : [];
  const want = words(v.name);
  const hit = feats.find((f) => {
    const [lng, lat] = f.geometry.coordinates;
    const got = new Set(words(`${f.properties.name ?? ""} ${f.properties.street ?? ""}`));
    return km(v.lat, v.lng, lat, lng) < 8 && want.some((w) => got.has(w));
  });
  if (hit) {
    const [lng, lat] = hit.geometry.coordinates;
    table[key] = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
    found++;
  } else table[key] = null; // looked up, not found: shown at the town centre
  await sleep(1000);
}
writeFileSync(OUT, JSON.stringify(table, null, 0).replace(/,"/g, ',\n"') + "\n");
console.log("located", found, "of", venues.size, "; table size", Object.keys(table).length);
