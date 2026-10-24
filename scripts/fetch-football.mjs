// Saves a snapshot of every scheduled match from football-data.org, used when the live API
// fails or no key is set. Run: FOOTBALL_DATA_KEY=… node scripts/fetch-football.mjs
import { writeFileSync } from "node:fs";

const KEY = process.env.FOOTBALL_DATA_KEY;
if (!KEY) throw new Error("Set FOOTBALL_DATA_KEY");
const OUT = new URL("../src/lib/providers/data/football-fixtures.json", import.meta.url);
const CODES = ["PL", "ELC", "PD", "BL1", "SA", "FL1", "DED", "PPL", "BSA", "CL", "WC", "EC"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const team = (t) => ({ id: t.id, name: t.name, shortName: t.shortName, crest: t.crest });

const competitions = {};
for (const code of CODES) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/matches?status=SCHEDULED,TIMED,POSTPONED`, { headers: { "X-Auth-Token": KEY } });
    if (res.ok) {
      const { matches = [] } = await res.json();
      competitions[code] = matches.map((m) => ({ id: m.id, utcDate: m.utcDate, status: m.status, matchday: m.matchday, stage: m.stage, group: m.group, competition: { code: m.competition.code, name: m.competition.name }, homeTeam: team(m.homeTeam), awayTeam: team(m.awayTeam) }));
      break;
    }
    // 400 "token is invalid" happens intermittently with valid keys; 429 is the per-minute limit.
    await sleep(res.status === 429 ? 61000 : 15000);
  }
  console.log(code, competitions[code]?.length ?? "failed");
  await sleep(7000);
}
writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), competitions }) + "\n");
