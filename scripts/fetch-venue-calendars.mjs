// Saves a snapshot of each Lisbon venue calendar (The Events Calendar public REST API),
// for servers whose network a venue refuses. Run: node scripts/fetch-venue-calendars.mjs
import { writeFileSync } from "node:fs";

const UA = "OMNIEVENT/1.0 (+https://omnievent.vercel.app)";
const OUT = new URL("../src/lib/providers/data/venue-calendars.json", import.meta.url);
const SOURCES = { ccb: "https://www.ccb.pt", chapito: "https://chapito.org" };

const slim = (e) => ({
  id: e.id,
  title: e.title,
  url: e.url,
  description: e.description ? String(e.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600) : undefined,
  image: e.image && e.image.url ? { url: e.image.url } : false,
  all_day: e.all_day,
  utc_start_date: e.utc_start_date,
  utc_end_date: e.utc_end_date,
  cost: e.cost,
  cost_details: { values: e.cost_details?.values ?? [] },
  website: e.website,
  categories: (e.categories ?? []).map((c) => ({ slug: c.slug })),
});

const today = new Date().toISOString().slice(0, 10);
const out = { fetchedAt: new Date().toISOString(), sources: {} };
for (const [id, base] of Object.entries(SOURCES)) {
  const events = [];
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(`${base}/wp-json/tribe/events/v1/events?per_page=50&page=${page}&start_date=${today}`, { headers: { "User-Agent": UA } });
    if (res.status === 400) break;
    if (!res.ok) throw new Error(`${id} page ${page}: HTTP ${res.status}`);
    const json = await res.json();
    events.push(...(json.events ?? []).map(slim));
    if (page >= (json.total_pages ?? 0)) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  out.sources[id] = events;
  console.log(id, events.length);
}
writeFileSync(OUT, JSON.stringify(out) + "\n");
