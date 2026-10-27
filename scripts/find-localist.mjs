// Finds public event calendars run on Localist: for every university domain in the
// open university-domains list (US, Canada, UK, Ireland, Australia, New Zealand), tries
// events., calendar., cal., calendars., eventcalendar. and happenings.<domain> for
// Localist's public API. Writes the calendars that answer to
// src/lib/providers/data/localist-hosts.json (existing entries are kept).
// Run: node scripts/find-localist.mjs
import { readFileSync, writeFileSync } from "node:fs";

const UA = "OMNIEVENT/1.0 (+https://omnievent.vercel.app)";
const LIST = "https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json";
const OUT = new URL("../src/lib/providers/data/localist-hosts.json", import.meta.url);

let hosts = [];
try {
  hosts = JSON.parse(readFileSync(OUT, "utf8"));
} catch {
  // first run
}
const known = new Set(hosts.map((h) => h.host));
const unis = await (await fetch(LIST, { headers: { "User-Agent": UA } })).json();
const candidates = new Map();
for (const u of unis) {
  if (!["US", "CA", "GB", "AU", "IE", "NZ"].includes(u.alpha_two_code)) continue;
  for (const d of u.domains ?? []) for (const p of ["events", "calendar", "cal", "calendars", "eventcalendar", "happenings"]) candidates.set(`${p}.${d.replace(/^www\./, "")}`, u.name);
}
const queue = [...candidates.keys()].filter((h) => !known.has(h));
console.log("candidates", queue.length);
await Promise.all(
  Array.from({ length: 40 }, async () => {
    while (queue.length) {
      const h = queue.shift();
      try {
        const r = await fetch(`https://${h}/api/2/events?days=365&pp=1`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
        if (!r.ok) continue;
        const j = await r.json();
        const host = new URL(r.url).host;
        if (j?.page?.total_items > 0 && Array.isArray(j.events) && !known.has(host)) {
          known.add(host);
          hosts.push({ host, name: candidates.get(h) });
          console.log("found", host, j.page.total_items);
        }
      } catch {
        // not a Localist calendar
      }
    }
  }),
);
hosts.sort((a, b) => a.host.localeCompare(b.host));
writeFileSync(OUT, JSON.stringify(hosts, null, 1) + "\n");
console.log("calendars", hosts.length);
