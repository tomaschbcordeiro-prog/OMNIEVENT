import { CITIES, slugify } from "../destinations";
import { groupOf } from "../categories";
import { convert } from "../currency";
import { localDateKey } from "../format";
import { zonedTimeToUtc } from "../time";
import type {
  EventStatus,
  OmniEvent,
  Participant,
  ParticipantKind,
  ParticipantRole,
  TicketAccess,
  TicketCategory,
  TicketOffer,
  Venue,
  Destination,
  TimeSlot,
} from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";

/**
 * DEMO PROVIDER — 100% fictional events, venues, people and offers.
 *
 * Places (cities, coordinates, time zones, currencies) are real geography so the
 * globe is meaningful; everything else is invented and flagged `isDemo: true`.
 * Output is deterministic for a given day so links stay stable, and dates are
 * generated relative to "today" so date filters ("this weekend") are testable.
 */

// ---------- deterministic PRNG ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Rng = () => number;
const pick = <T,>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
const between = (r: Rng, a: number, b: number) => a + (b - a) * r();
const int = (r: Rng, a: number, b: number) => Math.floor(between(r, a, b + 1));

// ---------- fictional name banks ----------
const ADJ = ["Velvet", "Neon", "Silver", "Hollow", "Golden", "Midnight", "Paper", "Crystal", "Northern", "Electric", "Quiet", "Wild", "Lunar", "Copper", "Indigo", "Static", "Solar", "Glass", "Amber", "Cobalt"];
const NOUN = ["Orbits", "Harbours", "Lanterns", "Foxes", "Tides", "Satellites", "Gardens", "Echoes", "Parades", "Comets", "Atlas", "Wolves", "Mirrors", "Rivers", "Signals", "Archives", "Cartographers", "Pilots", "Meridians", "Kites"];
const FIRST = ["Nova", "Ilya", "Maren", "Tomás", "Aiko", "Zuri", "Leif", "Inês", "Rafa", "Selene", "Kai", "Odile", "Arjun", "Mila", "Teo", "Yara", "Bram", "Noor", "Elio", "Saoirse", "Jun", "Amara", "Dario", "Freya"];
const LAST = ["Lark", "Vantablue", "Okonkwo-Reyes", "Halvorsen", "Moreau-Lin", "Castellane", "Ivers", "Takeda-Holm", "Quill", "Barros-Weiss", "Nakamura-Ode", "Delacroix-Ward", "Sørli", "Amadi", "Verhoef", "Kestrel"];
const TEAM_SUFFIX = ["Meridians", "Aurora FC", "Comets", "Harbour SC", "Lanterns", "Northstars", "Tidebreakers", "Ironclads", "Skylarks", "Rovers XI"];
const VENUE_KIND = [
  ["Arena", "arena", true],
  ["Hall", "concert_hall", true],
  ["Stadium", "stadium", false],
  ["Theatre", "theatre", true],
  ["Expo Centre", "convention_centre", true],
  ["Gallery", "gallery", true],
  ["Park", "park", false],
  ["Pavilion", "multi_purpose", true],
  ["Club", "club", true],
  ["Wharf", "outdoor", false],
] as const;
const VENUE_PREFIX = ["Meridian", "Lumen", "Atlas", "Halcyon", "Orbit", "Parallax", "Cinder", "Corvid", "Solstice", "Aster"];

// ---------- event templates ----------
interface Tpl {
  cat: string;
  weight: number;
  venue: (typeof VENUE_KIND)[number][1][];
  title: (r: Rng, city: Destination, p: string[]) => string;
  people?: { kind: ParticipantKind; role: ParticipantRole; n: [number, number] };
  hours: [number, number];
  duration: [number, number];
  usd?: [number, number];
  access?: TicketAccess;
  family?: boolean;
  minAge?: number;
  type?: OmniEvent["eventType"];
  multiDay?: [number, number];
  sport?: { sport: string; comps: string[]; stages: string[] };
  desc: string;
}

const bandName = (r: Rng) => (r() < 0.5 ? `The ${pick(r, ADJ)} ${pick(r, NOUN)}` : `${pick(r, FIRST)} ${pick(r, LAST)}`);
const personName = (r: Rng) => `${pick(r, FIRST)} ${pick(r, LAST)}`;

const TEMPLATES: Tpl[] = [
  { cat: "concerts", weight: 8, venue: ["arena", "concert_hall", "club"], people: { kind: "artist", role: "headliner", n: [1, 2] }, hours: [19, 21], duration: [90, 150], usd: [25, 140], title: (_r, _c, p) => `${p[0]} — Live`, desc: "A headline concert on the artist's (fictional) world tour." },
  { cat: "rock-metal", weight: 3, venue: ["arena", "club"], people: { kind: "artist", role: "headliner", n: [1, 3] }, hours: [19, 21], duration: [120, 180], usd: [30, 110], title: (_r, _c, p) => `${p[0]}${p[1] ? ` + ${p[1]}` : ""}`, desc: "Loud guitars and a full support bill." },
  { cat: "electronic", weight: 3, venue: ["club", "outdoor"], people: { kind: "artist", role: "dj", n: [2, 4] }, hours: [22, 23], duration: [300, 420], usd: [15, 60], minAge: 18, title: (r) => `${pick(r, ADJ)} Frequencies: All Night Long`, desc: "An all-night electronic programme across two rooms." },
  { cat: "jazz", weight: 2, venue: ["club", "concert_hall"], people: { kind: "artist", role: "artist", n: [1, 1] }, hours: [20, 21], duration: [90, 120], usd: [20, 70], title: (_r, _c, p) => `${p[0]} Quartet`, desc: "Intimate jazz set in two parts." },
  { cat: "classical", weight: 2, venue: ["concert_hall"], people: { kind: "performer", role: "performer", n: [1, 2] }, hours: [19, 20], duration: [110, 140], usd: [25, 160], title: (r) => `${pick(r, ["Symphony", "Requiem", "Nocturnes", "Concerto"])} in ${pick(r, ["D minor", "E-flat", "A major", "G"])} — ${pick(r, ADJ)} Philharmonic`, desc: "Orchestral programme with a guest soloist." },
  { cat: "opera", weight: 1, venue: ["theatre", "concert_hall"], people: { kind: "performer", role: "cast", n: [2, 4] }, hours: [19, 19], duration: [160, 200], usd: [40, 260], type: "recurring", title: (r) => `The ${pick(r, ["Glass", "Lantern", "Salt", "Winter"])} ${pick(r, ["Queen", "Garden", "Ferryman", "Bride"])} (opera)`, desc: "A new (fictional) opera production in three acts." },
  { cat: "music-festivals", weight: 2, venue: ["park", "outdoor"], people: { kind: "artist", role: "headliner", n: [3, 6] }, hours: [14, 16], duration: [480, 600], usd: [70, 260], type: "multi_day", multiDay: [2, 3], title: (r, c) => `${pick(r, ADJ)} ${pick(r, ["Fields", "Shores", "Skies"])} Festival ${c.name}`, desc: "Multi-stage festival with camping-free day passes." },
  { cat: "football", weight: 5, venue: ["stadium"], people: { kind: "team", role: "team_home", n: [2, 2] }, hours: [15, 21], duration: [110, 120], usd: [25, 180], sport: { sport: "Football", comps: ["Demo Continental League", "Omni Cup (demo)", "Demo Premier Division"], stages: ["Matchday 9", "Matchday 12", "Round of 16", "Quarter-final", "Group stage"] }, title: (_r, _c, p) => `${p[0]} vs ${p[1]}`, desc: "League fixture (fictional teams and competition)." },
  { cat: "basketball", weight: 2, venue: ["arena"], people: { kind: "team", role: "team_home", n: [2, 2] }, hours: [19, 20], duration: [140, 150], usd: [20, 220], sport: { sport: "Basketball", comps: ["Demo Hoops League"], stages: ["Regular season", "Playoffs — Game 2"] }, title: (_r, _c, p) => `${p[0]} vs ${p[1]}`, desc: "Basketball fixture (fictional teams)." },
  { cat: "tennis", weight: 1, venue: ["stadium", "arena"], people: { kind: "athlete", role: "competitor", n: [2, 2] }, hours: [11, 18], duration: [120, 240], usd: [30, 200], sport: { sport: "Tennis", comps: ["Demo Open"], stages: ["Round 2", "Quarter-final", "Semi-final", "Final"] }, title: (r, c, p) => `${c.name} Demo Open — ${p[0]} vs ${p[1]}`, desc: "Singles match (fictional players)." },
  { cat: "motorsport", weight: 1, venue: ["stadium", "outdoor"], hours: [13, 15], duration: [120, 180], usd: [80, 450], type: "multi_day", multiDay: [3, 3], sport: { sport: "Motorsport", comps: ["Demo Formula Series"], stages: ["Race weekend"] }, title: (_r, c) => `Demo Formula Series — ${c.name} Grand Prix`, desc: "Three-day race weekend: practice, qualifying and race (fictional series)." },
  { cat: "combat", weight: 1, venue: ["arena"], people: { kind: "athlete", role: "competitor", n: [2, 2] }, hours: [20, 21], duration: [180, 240], usd: [40, 300], minAge: 16, sport: { sport: "Boxing", comps: ["Demo Fight Night"], stages: ["Main card"] }, title: (_r, _c, p) => `Fight Night: ${p[0]} vs ${p[1]}`, desc: "Main event plus undercard (fictional fighters)." },
  { cat: "marathon", weight: 1, venue: ["outdoor", "park"], hours: [8, 9], duration: [360, 420], usd: [0, 0], access: "registration", sport: { sport: "Running", comps: ["Demo City Marathon"], stages: ["Race day"] }, title: (_r, c) => `${c.name} Demo City Marathon`, desc: "Spectating is free; runners must register (fictional event)." },
  { cat: "esports", weight: 1, venue: ["arena", "multi_purpose"], people: { kind: "team", role: "team", n: [2, 2] }, hours: [12, 17], duration: [300, 480], usd: [20, 90], sport: { sport: "Esports", comps: ["Demo Esports Masters"], stages: ["Playoffs", "Grand final"] }, title: (_r, _c, p) => `Demo Esports Masters: ${p[0]} vs ${p[1]}`, desc: "Live esports final on a giant screen." },
  { cat: "musicals", weight: 3, venue: ["theatre"], people: { kind: "performer", role: "cast", n: [3, 5] }, hours: [19, 20], duration: [150, 165], usd: [35, 220], type: "recurring", title: (r) => `${pick(r, ["Lantern", "Comet", "Harbour", "Paper Moon", "Velvet"])} ${pick(r, ["Street", "Hearts", "the Musical", "Avenue"])}`, desc: "A (fictional) hit musical with nightly performances." },
  { cat: "plays", weight: 2, venue: ["theatre"], people: { kind: "performer", role: "cast", n: [2, 4] }, hours: [19, 20], duration: [100, 140], usd: [20, 120], type: "recurring", title: (r) => `The ${pick(r, ADJ)} ${pick(r, ["Inheritance", "Room", "Crossing", "Letters", "Hour"])}`, desc: "New drama in two acts." },
  { cat: "ballet", weight: 1, venue: ["theatre", "concert_hall"], people: { kind: "performer", role: "cast", n: [2, 3] }, hours: [19, 19], duration: [120, 150], usd: [30, 180], type: "recurring", title: (r) => `${pick(r, ["Swan", "Ice", "Firebird", "Moonlight"])} ${pick(r, ["Variations", "Suite", "in Motion"])} (ballet)`, desc: "Classical ballet with live orchestra." },
  { cat: "stand-up", weight: 3, venue: ["club", "theatre"], people: { kind: "performer", role: "performer", n: [1, 1] }, hours: [20, 21], duration: [75, 100], usd: [15, 60], minAge: 16, title: (_r, _c, p) => `${p[0]}: ${pick(mulberry32(hashStr(p[0])), ["Overthinking It", "Nearly Famous", "Small Talk", "Out of Office"])}`, desc: "Stand-up special (fictional comedian)." },
  { cat: "circus", weight: 1, venue: ["park", "multi_purpose"], hours: [17, 19], duration: [100, 120], usd: [20, 80], family: true, type: "recurring", title: (r) => `Cirque ${pick(r, ADJ)}`, desc: "Contemporary circus for all ages." },
  { cat: "street-festivals", weight: 2, venue: ["outdoor", "park"], hours: [11, 14], duration: [480, 600], usd: [0, 0], access: "free", family: true, type: "multi_day", multiDay: [1, 3], title: (r, c) => `${c.name} ${pick(r, ["Lantern", "Summer", "Harbour", "Neighbourhood"])} Street Festival`, desc: "Free street festival with food stalls and live music." },
  { cat: "film-festivals", weight: 1, venue: ["theatre", "multi_purpose"], hours: [10, 18], duration: [120, 180], usd: [10, 25], type: "multi_day", multiDay: [4, 7], title: (r, c) => `${c.name} ${pick(r, ["Independent", "Documentary", "New Wave"])} Film Festival (demo)`, desc: "Festival screenings with Q&A sessions." },
  { cat: "outdoor-cinema", weight: 1, venue: ["park", "outdoor"], hours: [20, 21], duration: [120, 150], usd: [8, 20], family: true, title: (r) => `Open-Air Cinema: ${pick(r, ["Classic Night", "Cult Favourites", "Family Matinee"])}`, desc: "Bring a blanket — open-air screening." },
  { cat: "ai-conferences", weight: 2, venue: ["convention_centre"], people: { kind: "speaker", role: "speaker", n: [3, 5] }, hours: [9, 9], duration: [480, 540], usd: [150, 900], type: "multi_day", multiDay: [2, 3], title: (r, c) => `${pick(r, ["Applied AI", "Machine Minds", "Frontier AI"])} Summit ${c.name} (demo)`, desc: "Talks, workshops and an expo floor." },
  { cat: "developer-conferences", weight: 1, venue: ["convention_centre"], people: { kind: "speaker", role: "speaker", n: [3, 5] }, hours: [9, 9], duration: [480, 540], usd: [99, 600], type: "multi_day", multiDay: [2, 2], title: (r) => `${pick(r, ["DevHarbour", "StackConf", "Compile"])} ${pick(r, ["2026", "Europe", "Live"])} (demo)`, desc: "Developer conference with hands-on labs." },
  { cat: "startup-events", weight: 1, venue: ["convention_centre", "multi_purpose"], people: { kind: "speaker", role: "speaker", n: [2, 3] }, hours: [18, 18], duration: [180, 240], usd: [0, 30], access: "registration", title: (r, c) => `${c.name} Founders ${pick(r, ["Night", "Pitch Evening", "Mixer"])}`, desc: "Pitches and networking. Free with registration." },
  { cat: "trade-fairs", weight: 1, venue: ["convention_centre"], hours: [10, 10], duration: [480, 480], usd: [20, 80], type: "multi_day", multiDay: [3, 4], title: (r) => `${pick(r, ["Interiors", "Mobility", "Food Industry", "Design"])} Expo (demo)`, desc: "Trade fair with public days." },
  { cat: "career-fairs", weight: 1, venue: ["convention_centre"], hours: [10, 10], duration: [420, 420], usd: [0, 0], access: "registration", title: (_r, c) => `${c.name} Tech Careers Fair (demo)`, desc: "Meet employers. Free, registration required." },
  { cat: "hackathons", weight: 1, venue: ["convention_centre", "multi_purpose"], hours: [9, 10], duration: [1440, 2160], usd: [0, 0], access: "registration", type: "multi_day", multiDay: [2, 2], title: (r) => `${pick(r, ["Build", "Hack", "Ship"])}${pick(r, ["Weekend", "Sprint", "Night"])} Hackathon (demo)`, desc: "48-hour hackathon. Free with registration." },
  { cat: "art-exhibitions", weight: 3, venue: ["gallery"], people: { kind: "artist", role: "artist", n: [1, 1] }, hours: [10, 10], duration: [480, 480], usd: [10, 28], type: "daily_attraction", title: (r, _c, p) => `${p[0]}: ${pick(r, ["Field Notes", "Afterimage", "Tide Lines", "The Long Light"])}`, desc: "Temporary exhibition. Timed entry." },
  { cat: "photography", weight: 1, venue: ["gallery"], people: { kind: "artist", role: "artist", n: [1, 1] }, hours: [10, 10], duration: [480, 480], usd: [8, 18], type: "daily_attraction", title: (_r, _c, p) => `${p[0]} — Photographs`, desc: "Photography retrospective." },
  { cat: "digital-art", weight: 1, venue: ["gallery", "multi_purpose"], hours: [10, 10], duration: [600, 600], usd: [18, 40], family: true, type: "daily_attraction", title: (r) => `${pick(r, ADJ)} Light: An Immersive Installation`, desc: "Walk-through digital art installation." },
  { cat: "art-fairs", weight: 1, venue: ["convention_centre"], hours: [11, 11], duration: [420, 420], usd: [25, 60], type: "multi_day", multiDay: [3, 4], title: (_r, c) => `${c.name} Contemporary Art Fair (demo)`, desc: "Galleries from around the world." },
  { cat: "theme-parks", weight: 1, venue: ["park"], hours: [10, 10], duration: [600, 600], usd: [45, 110], family: true, type: "daily_attraction", title: (r) => `${pick(r, ["Orbit", "Lantern", "Comet"])} ${pick(r, ["World", "Bay", "Kingdom"])} Theme Park (demo)`, desc: "Daily admission. Child prices available." },
  { cat: "aquariums-zoos", weight: 1, venue: ["park", "multi_purpose"], hours: [9, 10], duration: [480, 540], usd: [18, 45], family: true, type: "daily_attraction", title: (_r, c) => `${c.name} Ocean House (demo aquarium)`, desc: "Daily timed-entry admission." },
  { cat: "observation-decks", weight: 1, venue: ["multi_purpose"], hours: [9, 9], duration: [780, 780], usd: [20, 45], family: true, type: "daily_attraction", title: (_r, c) => `${c.name} Skyline Deck (demo)`, desc: "Timed entry to a 360° viewing platform." },
  { cat: "escape-rooms", weight: 1, venue: ["multi_purpose"], hours: [12, 12], duration: [600, 600], usd: [25, 40], minAge: 12, type: "daily_attraction", title: (r) => `Escape: The ${pick(r, ADJ)} Archive`, desc: "60-minute escape room. Groups of 2–6." },
  { cat: "planetariums", weight: 1, venue: ["multi_purpose"], hours: [10, 10], duration: [480, 480], usd: [10, 22], family: true, type: "daily_attraction", title: (_r, c) => `${c.name} Star Dome (demo planetarium)`, desc: "Hourly full-dome shows." },
  { cat: "tastings", weight: 2, venue: ["club", "multi_purpose"], hours: [18, 19], duration: [120, 150], usd: [35, 95], minAge: 18, title: (r) => `${pick(r, ["Natural Wine", "Single Origin", "Craft Spirits", "Olive Oil"])} Tasting Evening`, desc: "Guided tasting with a sommelier (fictional)." },
  { cat: "food-festivals", weight: 2, venue: ["outdoor", "park"], hours: [12, 12], duration: [540, 600], usd: [0, 15], family: true, type: "multi_day", multiDay: [2, 3], title: (r, c) => `${c.name} ${pick(r, ["Street Food", "Taco", "Seafood", "Night Market"])} Festival (demo)`, desc: "Dozens of food stalls and live cooking." },
  { cat: "cooking-classes", weight: 1, venue: ["multi_purpose"], people: { kind: "performer", role: "performer", n: [1, 1] }, hours: [11, 18], duration: [150, 180], usd: [55, 120], title: (r, c) => `Cook Like a Local: ${c.name} ${pick(r, ["Classics", "Street Food", "Pastry"])}`, desc: "Hands-on cooking class in small groups." },
  { cat: "club-nights", weight: 2, venue: ["club"], people: { kind: "artist", role: "dj", n: [1, 3] }, hours: [23, 23], duration: [360, 360], usd: [10, 35], minAge: 18, title: (r) => `${pick(r, ADJ)} ${pick(r, ["Room", "Hours", "Society"])} Club Night`, desc: "Late-night club night." },
  { cat: "rooftop", weight: 1, venue: ["outdoor"], hours: [17, 18], duration: [300, 360], usd: [15, 45], minAge: 18, title: (r) => `Sunset ${pick(r, ["Rooftop", "Beach", "Pool"])} Session`, desc: "Sunset party with resident DJs." },
  { cat: "kids-theatre", weight: 2, venue: ["theatre"], people: { kind: "performer", role: "cast", n: [2, 3] }, hours: [11, 15], duration: [55, 70], usd: [10, 25], family: true, type: "recurring", title: (r) => `The ${pick(r, ["Little", "Brave", "Sleepy"])} ${pick(r, ["Dragon", "Lighthouse", "Robot", "Fox"])}`, desc: "Children's theatre, ages 3+. Under-12s must be accompanied by an adult." },
  { cat: "family-shows", weight: 1, venue: ["arena", "theatre"], hours: [11, 17], duration: [90, 110], usd: [20, 60], family: true, title: (r) => `${pick(r, ["Dinosaur", "Ocean", "Space", "Science"])} Live! Family Show`, desc: "Interactive family show." },
  { cat: "guided-tours", weight: 2, venue: ["outdoor"], people: { kind: "organizer", role: "organizer", n: [1, 1] }, hours: [10, 16], duration: [120, 180], usd: [15, 45], type: "daily_attraction", title: (r, c) => `${c.name} ${pick(r, ["Old Town", "Street Art", "Hidden Courtyards", "Architecture"])} Walking Tour`, desc: "Small-group guided walking tour." },
  { cat: "boat-tours", weight: 1, venue: ["outdoor"], hours: [11, 18], duration: [60, 120], usd: [20, 60], family: true, type: "daily_attraction", title: (r) => `${pick(r, ["Sunset", "Harbour", "Riverside"])} Cruise`, desc: "Scheduled sightseeing cruise." },
  { cat: "stargazing", weight: 1, venue: ["park", "outdoor"], hours: [21, 22], duration: [120, 150], usd: [20, 50], family: true, title: () => `Guided Stargazing Night`, desc: "Telescopes provided; weather-dependent." },
  { cat: "masterclasses", weight: 1, venue: ["multi_purpose", "gallery"], people: { kind: "speaker", role: "speaker", n: [1, 1] }, hours: [10, 14], duration: [180, 240], usd: [60, 220], title: (r, _c, p) => `${pick(r, ["Photography", "Songwriting", "Illustration", "Product Design"])} Masterclass with ${p[0]}`, desc: "Small-group masterclass." },
  { cat: "public-lectures", weight: 1, venue: ["theatre", "convention_centre"], people: { kind: "speaker", role: "speaker", n: [1, 1] }, hours: [18, 19], duration: [75, 90], usd: [0, 15], title: (r, _c, p) => `${p[0]} on ${pick(r, ["Cities of the Future", "The Ocean Floor", "Memory", "Deep Time"])}`, desc: "Public lecture with audience Q&A." },
  { cat: "fashion-weeks", weight: 1, venue: ["convention_centre", "gallery"], hours: [17, 19], duration: [90, 120], usd: [40, 180], type: "multi_day", multiDay: [3, 5], title: (_r, c) => `${c.name} Fashion Week — Public Runway (demo)`, desc: "Public-access runway shows." },
  { cat: "heritage", weight: 1, venue: ["outdoor", "park"], hours: [10, 18], duration: [240, 480], usd: [0, 0], access: "free", family: true, title: (r, c) => `${c.name} ${pick(r, ["Heritage Day", "Founders' Parade", "Lantern Procession"])} (demo)`, desc: "Free cultural celebration." },
];

const PROVIDERS = [
  { name: "DemoTix", type: "primary" as const, feesIncluded: false },
  { name: "SampleSeats", type: "official_resale" as const, feesIncluded: true },
  { name: "Demo Box Office", type: "box_office" as const, feesIncluded: true },
];

const DAY = 86400000;

function localYMD(t: number, tz: string): [number, number, number] {
  const s = localDateKey(new Date(t), tz);
  const [y, m, d] = s.split("-").map(Number);
  return [y, m, d];
}

function roundPrice(v: number, currency: string): number {
  if (["JPY", "KRW", "CLP", "IDR", "HUF", "COP", "ARS", "NGN"].includes(currency)) return Math.round(v / 100) * 100 || 100;
  if (v > 1000) return Math.round(v / 10) * 10;
  return Math.max(1, Math.round(v));
}

export function generateDemoData(now = new Date()): ProviderBatch {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const syncedAt = new Date(dayStart + 6 * 3600 * 1000).toISOString();
  const seedDay = Math.floor(dayStart / DAY);
  const events: OmniEvent[] = [];
  const venues: Venue[] = [];
  const participants = new Map<string, Participant>();
  const offers: TicketOffer[] = [];
  const totalWeight = TEMPLATES.reduce((s, t) => s + t.weight, 0);

  const prov = (id: string, verified = true) => ({
    provider: "demo",
    externalId: id,
    lastSyncedAt: syncedAt,
    lastVerifiedAt: verified ? syncedAt : undefined,
    isDemo: true,
  });

  const getParticipant = (r: Rng, kind: ParticipantKind, city: Destination): Participant => {
    let name: string;
    if (kind === "team") name = `${city.name} ${pick(r, TEAM_SUFFIX)}`;
    else if (kind === "artist") name = bandName(r);
    else name = personName(r);
    const slug = slugify(name);
    const existing = participants.get(slug);
    if (existing) return existing;
    const p: Participant = {
      id: `demo-p-${slug}`,
      slug,
      name,
      kind,
      country: city.country,
      description:
        kind === "team"
          ? `Fictional club based in ${city.name}, used for demonstration.`
          : `Fictional ${kind} profile used for demonstration.`,
      provenance: prov(`p-${slug}`),
    };
    participants.set(slug, p);
    return p;
  };

  for (const city of CITIES) {
    // Venue set for the city (stable across days: seeded by city only).
    const vr = mulberry32(hashStr(`venues:${city.id}`));
    const cityVenues: Venue[] = VENUE_KIND.map(([label, type, indoor], i) => {
      const name = `${pick(vr, VENUE_PREFIX)} ${label} ${city.name}`;
      const angle = vr() * Math.PI * 2;
      const distKm = 0.6 + vr() * (type === "stadium" || type === "park" ? 9 : 5);
      const lat = city.lat + (Math.sin(angle) * distKm) / 111;
      const lng = city.lng + (Math.cos(angle) * distKm) / (111 * Math.cos((city.lat * Math.PI) / 180));
      const v: Venue = {
        id: `demo-v-${city.id}-${i}`,
        slug: slugify(`${name}-${city.id}-${i}`),
        name,
        address: `${int(vr, 1, 240)} ${pick(vr, ["Harbour Road", "Avenida Central", "Station Street", "Park Lane", "Riverside Walk", "Rue des Lumières"])} (fictional)`,
        city: city.name,
        cityId: city.id,
        country: city.country!,
        countryCode: city.countryCode!,
        lat,
        lng,
        timeZone: city.timeZone!,
        venueType: type,
        indoor,
        capacity: type === "stadium" ? int(vr, 25, 80) * 1000 : type === "arena" ? int(vr, 8, 20) * 1000 : int(vr, 3, 30) * 100,
        accessibility: vr() < 0.7 ? ["Step-free access", "Accessible toilets", vr() < 0.5 ? "Hearing loop" : "Wheelchair spaces"] : undefined,
        provenance: prov(`v-${city.id}-${i}`),
      };
      return v;
    });
    venues.push(...cityVenues);

    const r = mulberry32(hashStr(`events:${city.id}:${seedDay}`));
    const big = ["london", "new-york", "paris", "tokyo", "berlin", "los-angeles", "lisbon", "madrid", "sao-paulo", "mexico-city", "sydney", "singapore", "seoul", "barcelona", "chicago", "toronto", "amsterdam", "rome", "dubai", "buenos-aires"].includes(city.id);
    const n = big ? int(r, 55, 80) : int(r, 18, 34);

    for (let i = 0; i < n; i++) {
      // weighted template pick
      let w = r() * totalWeight;
      let tpl = TEMPLATES[0];
      for (const t of TEMPLATES) {
        w -= t.weight;
        if (w <= 0) {
          tpl = t;
          break;
        }
      }
      const candidates = cityVenues.filter((v) => tpl.venue.includes(v.venueType as never));
      const venue = candidates.length ? pick(r, candidates) : cityVenues[0];

      const people: Participant[] = [];
      if (tpl.people) {
        const count = int(r, tpl.people.n[0], tpl.people.n[1]);
        for (let k = 0; k < count; k++) {
          const p = getParticipant(r, tpl.people.kind, tpl.people.kind === "team" && k === 1 ? pick(r, CITIES.filter((c) => c.continent === city.continent)) : city);
          if (!people.find((x) => x.id === p.id)) people.push(p);
        }
      }
      const names = people.map((p) => p.name);

      // Date: skew towards the next 60 days, up to 150 days; a few in the past (completed).
      const dayOffset = r() < 0.04 ? -int(r, 1, 6) : Math.floor(Math.pow(r(), 1.6) * 150);
      const [y, m, d] = localYMD(now.getTime() + dayOffset * DAY, city.timeZone!);
      const hour = int(r, tpl.hours[0], tpl.hours[1]);
      const minute = pick(r, [0, 0, 0, 30, 15, 45]);
      const start = zonedTimeToUtc(y, m, d, hour, minute, city.timeZone!);
      const duration = int(r, tpl.duration[0], tpl.duration[1]);
      const days = tpl.multiDay ? int(r, tpl.multiDay[0], tpl.multiDay[1]) : 1;
      const end = new Date(new Date(start).getTime() + (days > 1 ? (days - 1) * DAY : 0) + duration * 60000).toISOString();

      const access: TicketAccess = tpl.access ?? "ticketed";
      const isFree = access === "free";
      let status: EventStatus;
      let statusNote: string | undefined;
      let rescheduledFrom: string | undefined;
      if (dayOffset < 0) status = "completed";
      else if (access === "free") status = "free_entry";
      else if (access === "registration") status = "registration_required";
      else {
        const s = r();
        if (s < 0.68) status = "on_sale";
        else if (s < 0.78) status = "sold_out";
        else if (s < 0.84) status = "scheduled";
        else if (s < 0.88) {
          status = "postponed";
          statusNote = "Postponed by the (fictional) organiser. New date to be announced; existing tickets remain valid.";
        } else if (s < 0.92) {
          status = "rescheduled";
          rescheduledFrom = new Date(new Date(start).getTime() - int(r, 7, 40) * DAY).toISOString();
          statusNote = "Moved to a new date. Original tickets are valid for the new date.";
        } else if (s < 0.95) {
          status = "cancelled";
          statusNote = "Cancelled. Refunds are handled by the original point of purchase.";
        } else status = "unknown";
      }

      const id = `demo-e-${city.id}-${seedDay}-${i}`;
      const title = tpl.title(r, city, names);
      const slug = `${slugify(title)}-${slugify(city.name)}-${hashStr(id).toString(36).slice(0, 5)}`;
      const group = groupOf(tpl.cat);
      const isAttraction = tpl.type === "daily_attraction";

      const ev: OmniEvent = {
        id,
        canonicalId: id,
        slug,
        title,
        description: `${tpl.desc} This listing is fictional demonstration data generated by OMNIEVENT's demo provider — it is not a real event and tickets cannot be purchased.`,
        categorySlug: tpl.cat,
        groupSlug: group,
        eventType: tpl.type ?? (days > 1 ? "multi_day" : "single"),
        venueId: venue.id,
        start,
        end,
        timeZone: city.timeZone!,
        durationMinutes: duration,
        status,
        statusNote,
        rescheduledFrom,
        ticketAccess: access,
        isFree,
        registrationRequired: access === "registration",
        online: false,
        familyFriendly: !!tpl.family,
        ageRestriction: tpl.minAge
          ? { minAge: tpl.minAge, note: `Ages ${tpl.minAge}+ only. Photo ID may be required.` }
          : tpl.family
            ? { guardianRequiredUnder: 12, note: "Children under 12 must be accompanied by an adult." }
            : undefined,
        accessibility: venue.accessibility,
        posterHue: Math.floor(r() * 360),
        participants: people.map((p, k) => ({
          participantId: p.id,
          role: tpl.people!.kind === "team" ? (k === 0 ? "team_home" : "team_away") : k === 0 ? tpl.people!.role : tpl.people!.role === "headliner" ? "support" : tpl.people!.role,
          order: k,
        })),
        sports: tpl.sport ? { sport: tpl.sport.sport, competition: pick(r, tpl.sport.comps), stage: pick(r, tpl.sport.stages), season: `${y}/${(y + 1) % 100}` } : undefined,
        schedule:
          tpl.type === "recurring"
            ? Array.from({ length: int(r, 4, 9) }, (_, k) => {
                const [yy, mm, dd] = localYMD(new Date(start).getTime() + (k + 1) * int(r, 1, 3) * DAY, city.timeZone!);
                return zonedTimeToUtc(yy, mm, dd, hour, minute, city.timeZone!);
              })
            : undefined,
        timeSlots: isAttraction
          ? Array.from({ length: 6 }, (_, k): TimeSlot => {
              const s0 = new Date(start).getTime() + k * 90 * 60000;
              const a = r();
              return { start: new Date(s0).toISOString(), end: new Date(s0 + 90 * 60000).toISOString(), availability: a < 0.6 ? "available" : a < 0.85 ? "limited" : "sold_out" };
            })
          : undefined,
        tags: [tpl.cat, group, venue.indoor ? "indoor" : "outdoor"],
        announcedAt: new Date(dayStart - int(r, 0, 90) * DAY).toISOString(),
        editorialPick: r() < 0.03,
        officialUrl: undefined,
        provenance: { ...prov(id), completeness: 0.9 },
      };
      if (isAttraction) {
        // A daily attraction "starts" today and is valid through the end of the window.
        const [ty, tm, td] = localYMD(now.getTime(), city.timeZone!);
        ev.start = zonedTimeToUtc(ty, tm, td, hour, minute, city.timeZone!);
        ev.end = new Date(dayStart + int(r, 30, 120) * DAY).toISOString();
        if (ev.status === "postponed" || ev.status === "rescheduled") ev.status = "on_sale";
      }
      events.push(ev);

      // Ticket offers
      if (tpl.usd && tpl.usd[1] > 0 && access === "ticketed") {
        const currency = city.currency!;
        const baseUsd = between(r, tpl.usd[0], (tpl.usd[0] + tpl.usd[1]) / 2);
        const providers = PROVIDERS.slice(0, int(r, 1, 3));
        providers.forEach((pv, k) => {
          const cats: TicketCategory[] = isAttraction
            ? (["standard", "child", "family"] as TicketCategory[]).slice(0, tpl.family ? 3 : 1)
            : group === "sports"
              ? ["reserved", "hospitality"]
              : tpl.type === "multi_day"
                ? ["day_pass", "multi_day_pass"]
                : r() < 0.5
                  ? ["general_admission", "vip"]
                  : ["reserved"];
          cats.forEach((tc, j) => {
            const mult = tc === "vip" || tc === "hospitality" ? between(r, 2.2, 4) : tc === "child" ? 0.55 : tc === "family" ? 3.2 : tc === "multi_day_pass" ? days * 0.85 : 1;
            const base = roundPrice(convert(baseUsd * mult * (1 + k * 0.06), "USD", currency)!, currency);
            const fee = pv.feesIncluded ? undefined : roundPrice(base * between(r, 0.08, 0.15), currency);
            const avail = status === "sold_out" ? "sold_out" : status === "cancelled" || status === "completed" ? "not_on_sale" : status === "scheduled" ? "not_on_sale" : r() < 0.75 ? "available" : "limited";
            const offerId = `${id}-o${k}${j}`;
            offers.push({
              id: offerId,
              eventId: id,
              provider: pv.name,
              providerType: pv.type,
              providerEventId: `${pv.name.toLowerCase()}-${hashStr(id).toString(16)}`,
              ticketCategory: tc,
              basePrice: base,
              maxPrice: tc === "reserved" || tc === "general_admission" ? roundPrice(base * between(r, 1.4, 2.6), currency) : undefined,
              feeAmount: fee,
              // Total is only "verified" when the provider reports both parts (demo: DemoTix) or fees are included.
              totalPrice: pv.feesIncluded ? base : fee !== undefined ? +(base + fee).toFixed(2) : undefined,
              feesIncluded: pv.feesIncluded,
              currency,
              availability: avail,
              purchaseUrl: `/out/${encodeURIComponent(offerId)}`,
              priceObservedAt: new Date(new Date(syncedAt).getTime() - int(r, 0, 20) * 3600000).toISOString(),
              availabilityVerifiedAt: syncedAt,
              isDemo: true,
            });
          });
        });
      }
    }
  }

  return { events, venues, participants: [...participants.values()], offers };
}

export const demoProvider: ProviderAdapter = {
  id: "demo",
  name: "OMNIEVENT demo data (fictional)",
  isDemo: true,
  coverage: `Fictional events generated for ${CITIES.length} real cities so every feature can be explored without API keys.`,
  isConfigured: () => true,
  refreshIntervalMs: 6 * 3600 * 1000,
  async sync() {
    const batch = generateDemoData(new Date());
    return { batch, run: { imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true, finishedAt: new Date().toISOString() } };
  },
};
