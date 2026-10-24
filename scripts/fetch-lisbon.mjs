// Saves a snapshot of the Agenda Cultural de Lisboa API (https://www.agendalx.pt/api/,
// City of Lisbon open data, CC BY 4.0) for servers whose network the API refuses.
// Run: node scripts/fetch-lisbon.mjs   (the GitHub workflow runs it daily)
import { writeFileSync } from "node:fs";

const BASE = "https://www.agendalx.pt/wp-json/agendalx/v1/events";
const UA = "OMNIEVENT/1.0 (+https://omnievent.vercel.app)";
const OUT = new URL("../src/lib/providers/data/lisbon-events.json", import.meta.url);
const KEEP = ["id", "title", "featured_media_large", "subtitle", "subject", "string_times", "venue", "categories_name_list", "tags_name_list", "link", "occurences", "StartDate", "LastDate", "price_cat", "price_val"];

const events = [];
for (let page = 1; page <= 40; page++) {
  const res = await fetch(`${BASE}?per_page=50&page=${page}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`page ${page}: HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) break;
  for (const e of list) {
    const slim = Object.fromEntries(KEEP.filter((k) => k in e).map((k) => [k, e[k]]));
    // Keep the first paragraph of the description only; the full text is on the agenda.
    const d = Array.isArray(e.description) ? e.description[0] : e.description;
    if (d) slim.description = String(d).slice(0, 600);
    events.push(slim);
  }
  if (list.length < 50) break;
  await new Promise((r) => setTimeout(r, 300));
}
if (events.length < 50) throw new Error(`only ${events.length} events, keeping the previous snapshot`);
writeFileSync(OUT, JSON.stringify({ source: BASE, licence: "CC BY 4.0, Câmara Municipal de Lisboa", fetchedAt: new Date().toISOString(), events }) + "\n");
console.log(`saved ${events.length} events`);
