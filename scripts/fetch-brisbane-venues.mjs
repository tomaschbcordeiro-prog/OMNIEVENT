// Locates the Brisbane City Council venues whose event listings carry an address but no
// coordinates. A result is kept only when it lies in the Brisbane area and names the same
// street or suburb. Run: node scripts/fetch-brisbane-venues.mjs   (re-run to add new venues)
import { readFileSync, writeFileSync } from "node:fs";

const UA = "OMNIEVENT/1.0 (+https://omnievent.vercel.app)";
const FEED = "https://www.trumba.com/calendars/brisbane-city-council.json";
const OUT = new URL("../src/lib/providers/data/brisbane-venues.json", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

let table = {};
try {
  table = JSON.parse(readFileSync(OUT, "utf8"));
} catch {
  // first run
}

const venues = new Map();
const now = new Date();
for (let i = 0; i < 14; i++) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const list = await (await fetch(`${FEED}?startdate=${ymd}&months=1`, { headers: { "User-Agent": UA } })).json();
  for (const e of list) {
    const cf = Object.fromEntries((e.customFields ?? []).map((c) => [c.label, c.value]));
    // The venue field itself is sometimes a map link.
    const name = decode((cf.Venue || e.location || "").replace(/<[^>]+>/g, "")).trim();
    const link = cf["Venue address"] || (/<a /.test(cf.Venue ?? "") ? cf.Venue : "");
    if (!name || /q=-?\d+\.\d+,-?\d+\.\d+/.test(link)) continue;
    const text = decode(link.replace(/<[^>]+>/g, "")).trim();
    const q = decodeURIComponent((link.match(/q=([^"&]+)/)?.[1] ?? "").replace(/\+/g, " "));
    venues.set(name, { text, q });
  }
}
console.log("venues without coordinates", venues.size);

let found = 0;
for (const [name, { text, q }] of venues) {
  if (name in table) continue;
  const query = q && !/^-?\d/.test(q) ? q : `${text || name}, Brisbane QLD`;
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=-27.47&lon=153.02&limit=5`, { headers: { "User-Agent": UA } }).catch(() => null);
  const feats = res && res.ok ? (await res.json()).features : [];
  const words = `${text} ${q} ${name}`.toLowerCase();
  const hit = feats.find((f) => {
    const [lng, lat] = f.geometry.coordinates;
    if (lat < -27.75 || lat > -27.0 || lng < 152.65 || lng > 153.35) return false;
    const p = f.properties;
    const street = (p.street ?? "").toLowerCase().replace(/\b(street|road|avenue|terrace|drive|parade|place)\b/g, "").trim();
    const suburb = (p.district ?? p.locality ?? p.city ?? "").toLowerCase();
    return (street.length > 3 && words.includes(street)) || (suburb.length > 3 && words.includes(suburb) && p.name && words.includes(p.name.toLowerCase().split(" ")[0]));
  });
  table[name] = hit ? { lat: +hit.geometry.coordinates[1].toFixed(6), lng: +hit.geometry.coordinates[0].toFixed(6) } : null;
  if (hit) found++;
  await sleep(1000);
}
writeFileSync(OUT, JSON.stringify(table, null, 1) + "\n");
console.log("located", found, "; table", Object.keys(table).length);
