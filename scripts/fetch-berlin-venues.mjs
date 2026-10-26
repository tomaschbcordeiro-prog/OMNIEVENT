// Locates the venues of Berlin's open culture data (kulturdaten.berlin), which publishes
// addresses but no coordinates. A result is kept only when it is in Berlin and its postcode
// matches. Run: node scripts/fetch-berlin-venues.mjs   (re-run to add new venues)
import { readFileSync, writeFileSync } from "node:fs";

const UA = "OMNIEVENT/1.0 (+https://omnievent.vercel.app)";
const API = "https://api-v2.kulturdaten.berlin/api";
const OUT = new URL("../src/lib/providers/data/berlin-venues.json", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let table = {};
try {
  table = JSON.parse(readFileSync(OUT, "utf8"));
} catch {
  // first run
}

const locations = [];
for (let page = 1; ; page++) {
  const json = await (await fetch(`${API}/locations?pageSize=500&page=${page}`, { headers: { "User-Agent": UA } })).json();
  const list = json.data?.locations ?? [];
  locations.push(...list);
  if (list.length < 500) break;
}
console.log("locations", locations.length);

let found = 0;
let tried = 0;
for (const l of locations) {
  if (l.identifier in table || l.isVirtual) continue;
  const a = l.address ?? {};
  if (!a.streetAddress || !a.postalCode) {
    table[l.identifier] = null;
    continue;
  }
  tried++;
  const q = `${a.streetAddress}, ${a.postalCode} Berlin`;
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=52.52&lon=13.405&limit=3`, { headers: { "User-Agent": UA } }).catch(() => null);
  const feats = res && res.ok ? (await res.json()).features : [];
  const hit = feats.find((f) => (f.properties.postcode ?? "") === a.postalCode && /berlin/i.test(`${f.properties.city ?? ""} ${f.properties.state ?? ""}`));
  table[l.identifier] = hit ? { lat: +hit.geometry.coordinates[1].toFixed(6), lng: +hit.geometry.coordinates[0].toFixed(6) } : null;
  if (hit) found++;
  if (tried % 200 === 0) {
    writeFileSync(OUT, JSON.stringify(table).replace(/,"/g, ',\n"') + "\n");
    console.log("progress", tried, "located", found);
  }
  await sleep(1000);
}
writeFileSync(OUT, JSON.stringify(table).replace(/,"/g, ',\n"') + "\n");
console.log("located", found, "of", tried, "; table", Object.keys(table).length);
