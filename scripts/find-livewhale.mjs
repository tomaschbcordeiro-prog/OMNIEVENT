// Finds public event calendars run on LiveWhale: for every university domain in the open
// university-domains list (US, Canada, UK, Ireland, Australia, New Zealand), tries calendar.,
// events. and www.<domain> for LiveWhale's public JSON (/live/json/events). Writes the
// calendars that answer with upcoming events to src/lib/providers/data/livewhale-hosts.json
// (existing entries are kept).
// Run: node scripts/find-livewhale.mjs
import { readFileSync, writeFileSync } from "node:fs";

const UA = "OMNIEVENT/1.0 (+https://omnievent.vercel.app)";
const LIST = "https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json";
const OUT = new URL("../src/lib/providers/data/livewhale-hosts.json", import.meta.url);
const LOCALIST = new URL("../src/lib/providers/data/localist-hosts.json", import.meta.url);

let hosts = [];
try {
  hosts = JSON.parse(readFileSync(OUT, "utf8"));
} catch {
  // first run
}
const known = new Set(hosts.map((h) => h.host));
// A calendar already read through Localist isn't read twice.
for (const h of JSON.parse(readFileSync(LOCALIST, "utf8"))) known.add(h.host);
const knownDomains = new Set([...known].map((h) => h.split(".").slice(-2).join(".")));

const unis = await (await fetch(LIST, { headers: { "User-Agent": UA } })).json();
const candidates = new Map();
for (const u of unis) {
  if (!["US", "CA", "GB", "AU", "IE", "NZ"].includes(u.alpha_two_code)) continue;
  for (const d of u.domains ?? []) {
    const base = d.replace(/^www\./, "");
    // One calendar per institution is enough.
    if (knownDomains.has(base.split(".").slice(-2).join("."))) continue;
    for (const p of ["calendar", "events", "www"]) candidates.set(`${p}.${base}`, u.name);
  }
}
const queue = [...candidates.keys()].filter((h) => !known.has(h));
console.log("candidates", queue.length);
const found = new Set();
await Promise.all(
  Array.from({ length: 40 }, async () => {
    while (queue.length) {
      const h = queue.shift();
      const domain = h.split(".").slice(-2).join(".");
      if (found.has(domain)) continue;
      try {
        const r = await fetch(`https://${h}/live/json/events/max/100/response_fields/location/`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12000), redirect: "follow" });
        if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) continue;
        const j = await r.json();
        const list = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : null;
        const host = new URL(r.url).host;
        const placed = (list ?? []).filter((e) => e?.title && Number(e.location_latitude) && Number(e.location_longitude)).length;
        if (placed >= 3 && !known.has(host) && !found.has(domain)) {
          found.add(domain);
          known.add(host);
          hosts.push({ host, name: candidates.get(h) });
          console.log("found", host, placed);
        }
      } catch {
        // not a LiveWhale calendar
      }
    }
  }),
);
hosts.sort((a, b) => a.host.localeCompare(b.host));
writeFileSync(OUT, JSON.stringify(hosts, null, 1) + "\n");
console.log("calendars", hosts.length);
