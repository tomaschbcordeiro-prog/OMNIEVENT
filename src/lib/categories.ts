import type { Category } from "./types";

/**
 * Category tree. Adding a category = adding a row here (or in the `categories`
 * table in Postgres). Depth is unlimited: `parent` may point at any category.
 * Top-level groups carry the marker colour used on the globe.
 */
const G = (
  slug: string,
  name: string,
  icon: string,
  color: string,
  order: number,
  description: string,
  keywords: string[] = [],
): Category => ({ slug, name, icon, color, order, description, keywords, active: true });

const C = (
  parent: string,
  slug: string,
  name: string,
  keywords: string[] = [],
  icon?: string,
): Category => ({ slug, name, parent, icon: icon ?? "", order: 0, active: true, keywords });

export const GROUPS: Category[] = [
  G("music", "Music", "music", "var(--cat-music)", 1, "Concerts, tours, festivals, classical, opera, jazz, electronic and every live sound.", ["concert", "concerts", "gig", "gigs", "music", "live music", "tour", "música", "musique", "concerto", "concertos", "concierto", "conciertos"]),
  G("sports", "Sports", "trophy", "var(--cat-sports)", 2, "Matches, races, fights, finals and championships across every sport.", ["sport", "sports", "match", "matches", "game", "games", "fixture", "fixtures", "desporto", "desportos", "deporte", "deportes", "jogo", "jogos", "partido"]),
  G("theatre", "Theatre & Performing Arts", "drama", "var(--cat-theatre)", 3, "Plays, musicals, ballet, dance, opera productions and touring stage shows.", ["theatre", "theater", "show", "shows", "stage", "broadway", "west end", "teatro", "théâtre", "espetáculo", "espectáculo", "spectacle"]),
  G("comedy", "Comedy", "laugh", "var(--cat-theatre)", 4, "Stand-up, improv, sketch and comedy festivals.", ["comedy", "comedian", "stand-up", "standup", "improv", "comédia", "comedia", "humor", "humour", "comédie"]),
  G("festivals", "Festivals & Culture", "sparkles", "var(--cat-festivals)", 5, "Festivals, carnivals, cultural celebrations and city-wide events.", ["festival", "festivals", "carnival", "celebration", "fiesta"]),
  G("cinema", "Cinema", "clapperboard", "var(--cat-festivals)", 6, "Premieres, festival screenings, outdoor and premium-format cinema.", ["cinema", "film", "films", "movie", "movies", "screening", "premiere", "imax", "filme", "filmes", "cine", "película"]),
  G("conferences", "Conferences & Business", "presentation", "var(--cat-conferences)", 7, "Conferences, summits, trade fairs, expos, hackathons and networking.", ["conference", "conferences", "summit", "expo", "trade fair", "congress", "business", "networking"]),
  G("technology", "Technology", "cpu", "var(--cat-conferences)", 8, "Developer, AI, startup and technology events.", ["tech", "technology", "developer", "ai", "startup", "hackathon"]),
  G("exhibitions", "Exhibitions & Museums", "frame", "var(--cat-exhibitions)", 9, "Art, photography, science and design exhibitions, biennales and art fairs.", ["exhibition", "exhibitions", "museum", "museums", "gallery", "art", "biennale", "exposição", "exposições", "exposición", "exposiciones", "exposition", "museu", "museo", "musée", "galeria", "arte"]),
  G("attractions", "Attractions & Experiences", "ferris-wheel", "var(--cat-attractions)", 10, "Theme parks, aquariums, observation decks, immersive and timed-entry experiences.", ["attraction", "attractions", "theme park", "zoo", "aquarium", "immersive", "experience", "experiences"]),
  G("food-drink", "Food & Drink", "utensils", "var(--cat-festivals)", 11, "Tastings, culinary workshops, food tours and special dining.", ["food", "drink", "wine", "tasting", "culinary", "gastronomy", "dinner", "comida", "vinho", "vino", "gastronomia", "gastronomía", "prova de vinhos"]),
  G("nightlife", "Nightlife", "moon-star", "var(--cat-music)", 12, "Club nights, rooftop and beach parties and social events.", ["nightlife", "club", "clubbing", "party", "parties", "rave", "discoteca", "noite", "vida noturna", "soirée"]),
  G("family", "Family & Kids", "baby", "var(--cat-family)", 13, "Children's theatre, family shows, kids' festivals and family attractions.", ["family", "kids", "children", "child", "family-friendly"]),
  G("outdoor", "Outdoor & Adventure", "mountain", "var(--cat-exhibitions)", 14, "Guided adventures, tours, wildlife, stargazing and outdoor activities.", ["outdoor", "adventure", "hiking", "tour", "tours", "excursion", "wildlife", "ar livre", "natureza", "caminhada", "aire libre", "senderismo", "randonnée"]),
  G("education", "Education & Workshops", "graduation-cap", "var(--cat-conferences)", 15, "Workshops, masterclasses, classes and public lectures.", ["workshop", "workshops", "class", "classes", "masterclass", "lecture", "course", "oficina", "oficinas", "taller", "talleres", "curso", "palestra", "atelier"]),
  G("fashion", "Fashion & Lifestyle", "shirt", "var(--cat-theatre)", 16, "Fashion weeks, runway shows, design fairs and lifestyle festivals.", ["fashion", "runway", "fashion week", "design fair", "lifestyle"]),
  G("culture", "Cultural Events", "landmark", "var(--cat-festivals)", 17, "Heritage, traditional and community cultural events.", ["cultural", "culture", "heritage", "traditional"]),
  G("other", "Other", "circle-dot", "var(--cat-other)", 99, "Other publicly bookable events.", []),
];

export const SUBCATEGORIES: Category[] = [
  // Music
  C("music", "concerts", "Concerts", ["concert"]),
  C("music", "music-festivals", "Music festivals", ["music festival"]),
  C("music", "classical", "Classical", ["classical", "symphony", "orchestra", "orchestral", "clássica", "clásica", "orquestra", "orquesta"]),
  C("music", "opera", "Opera", ["opera", "ópera"]),
  C("music", "jazz", "Jazz", ["jazz"]),
  C("music", "electronic", "Electronic", ["electronic", "techno", "house", "edm"]),
  C("music", "rock-metal", "Rock & metal", ["rock", "metal"]),
  C("music", "hip-hop", "Hip-hop & rap", ["hip-hop", "hip hop", "rap"]),
  C("music", "pop", "Pop", ["pop"]),
  C("music", "indie", "Indie", ["indie"]),
  C("music", "acoustic", "Acoustic", ["acoustic", "unplugged"]),
  C("music", "dj-sets", "Live DJ sets", ["dj", "dj set"]),
  C("music", "tribute", "Tribute shows", ["tribute"]),
  C("music", "music-awards", "Music awards", ["awards"]),
  // Sports
  C("sports", "football", "Football / soccer", ["football", "soccer", "futebol", "fútbol"]),
  C("sports", "basketball", "Basketball", ["basketball", "nba"]),
  C("sports", "tennis", "Tennis", ["tennis"]),
  C("sports", "motorsport", "Motorsport", ["formula", "formula racing", "f1", "motorsport", "racing", "grand prix", "rally"]),
  C("sports", "american-football", "American football", ["american football", "nfl"]),
  C("sports", "rugby", "Rugby", ["rugby"]),
  C("sports", "cricket", "Cricket", ["cricket"]),
  C("sports", "baseball", "Baseball", ["baseball", "mlb"]),
  C("sports", "ice-hockey", "Ice hockey", ["hockey", "ice hockey", "nhl"]),
  C("sports", "volleyball", "Volleyball", ["volleyball"]),
  C("sports", "golf", "Golf", ["golf"]),
  C("sports", "combat", "Boxing & MMA", ["boxing", "mma", "ufc", "fight", "wrestling"]),
  C("sports", "athletics", "Athletics", ["athletics", "track and field"]),
  C("sports", "marathon", "Marathon & running", ["marathon", "half marathon", "running"]),
  C("sports", "cycling", "Cycling", ["cycling"]),
  C("sports", "swimming", "Swimming", ["swimming"]),
  C("sports", "winter-sports", "Winter sports", ["ski", "skiing", "snowboard", "winter sports"]),
  C("sports", "esports", "Esports", ["esports", "e-sports", "gaming tournament"]),
  // Theatre
  C("theatre", "plays", "Plays", ["play", "plays", "drama"]),
  C("theatre", "musicals", "Musicals", ["musical", "musicals", "broadway"]),
  C("theatre", "ballet", "Ballet", ["ballet"]),
  C("theatre", "dance", "Contemporary dance", ["dance", "contemporary dance", "dança", "danza", "danse"]),
  C("theatre", "circus", "Circus", ["circus", "acrobatics"]),
  C("theatre", "magic", "Magic shows", ["magic", "magician", "illusionist"]),
  C("theatre", "immersive-theatre", "Immersive theatre", ["immersive theatre"]),
  C("theatre", "cabaret", "Cabaret", ["cabaret", "burlesque"]),
  C("theatre", "spoken-word", "Poetry & spoken word", ["poetry", "spoken word"]),
  // Comedy
  C("comedy", "stand-up", "Stand-up", ["stand-up", "standup"]),
  C("comedy", "improv", "Improv", ["improv"]),
  // Festivals
  C("festivals", "carnival", "Carnival", ["carnival", "carnaval"]),
  C("festivals", "street-festivals", "Street festivals", ["street festival"]),
  C("festivals", "pride", "Pride", ["pride"]),
  C("festivals", "literary-festivals", "Literary festivals", ["book festival", "literary"]),
  C("festivals", "art-festivals", "Art festivals", ["art festival"]),
  C("festivals", "seasonal-festivals", "Seasonal festivals", ["christmas market", "seasonal", "lantern"]),
  // Cinema
  C("cinema", "film-festivals", "Film festivals", ["film festival"]),
  C("cinema", "premieres", "Premieres", ["premiere"]),
  C("cinema", "outdoor-cinema", "Outdoor cinema", ["outdoor cinema", "open-air cinema"]),
  C("cinema", "premium-format", "IMAX & premium format", ["imax", "70mm"]),
  // Conferences
  C("conferences", "business-conferences", "Business conferences", ["business conference"]),
  C("conferences", "trade-fairs", "Trade fairs & expos", ["trade fair", "expo", "fair"]),
  C("conferences", "career-fairs", "Career & job fairs", ["career fair", "job fair"]),
  C("conferences", "scientific", "Scientific congresses", ["congress", "scientific"]),
  C("conferences", "marketing", "Marketing & design", ["marketing", "design conference"]),
  // Technology
  C("technology", "developer-conferences", "Developer conferences", ["developer", "devcon"]),
  C("technology", "ai-conferences", "AI conferences", ["ai", "artificial intelligence", "machine learning"]),
  C("technology", "startup-events", "Startup events", ["startup", "startups", "founder"]),
  C("technology", "hackathons", "Hackathons", ["hackathon"]),
  // Exhibitions
  C("exhibitions", "art-exhibitions", "Art exhibitions", ["art exhibition", "art"]),
  C("exhibitions", "photography", "Photography", ["photography exhibition"]),
  C("exhibitions", "science-exhibitions", "Science exhibitions", ["science"]),
  C("exhibitions", "history-exhibitions", "History & heritage", ["history", "historical"]),
  C("exhibitions", "design-exhibitions", "Design & architecture", ["architecture", "design exhibition"]),
  C("exhibitions", "digital-art", "Digital art & installations", ["digital art", "installation"]),
  C("exhibitions", "art-fairs", "Art fairs & biennales", ["art fair", "biennale", "biennial"]),
  // Attractions
  C("attractions", "theme-parks", "Theme parks", ["theme park", "amusement park", "water park"]),
  C("attractions", "aquariums-zoos", "Aquariums & zoos", ["aquarium", "zoo"]),
  C("attractions", "observation-decks", "Observation decks", ["observation deck", "skyline", "tower"]),
  C("attractions", "immersive-experiences", "Immersive experiences", ["immersive", "vr", "virtual reality"]),
  C("attractions", "escape-rooms", "Escape rooms", ["escape room"]),
  C("attractions", "planetariums", "Planetariums & science centres", ["planetarium", "science center", "science centre"]),
  // Food & drink
  C("food-drink", "tastings", "Tastings", ["tasting", "wine tasting"]),
  C("food-drink", "food-festivals", "Food festivals", ["food festival"]),
  C("food-drink", "cooking-classes", "Cooking classes", ["cooking class"]),
  C("food-drink", "food-tours", "Food tours", ["food tour"]),
  C("food-drink", "supper-clubs", "Special dining", ["supper club", "dinner experience"]),
  // Nightlife
  C("nightlife", "club-nights", "Club nights", ["club night"]),
  C("nightlife", "rooftop", "Rooftop & beach parties", ["rooftop", "beach party", "pool party"]),
  // Family
  C("family", "kids-theatre", "Children's theatre", ["children's theatre", "kids show"]),
  C("family", "family-shows", "Family shows", ["family show"]),
  C("family", "kids-festivals", "Children's festivals", ["kids festival"]),
  // Outdoor
  C("outdoor", "guided-tours", "Guided tours", ["guided tour", "city tour", "walking tour"]),
  C("outdoor", "boat-tours", "Boat tours", ["boat tour", "cruise"]),
  C("outdoor", "stargazing", "Stargazing", ["stargazing", "astronomy"]),
  C("outdoor", "hiking", "Hiking & climbing", ["hike", "hiking", "climbing"]),
  // Education
  C("education", "masterclasses", "Masterclasses", ["masterclass"]),
  C("education", "public-lectures", "Public lectures", ["lecture", "talk"]),
  C("education", "creative-workshops", "Creative workshops", ["workshop", "art class", "photography class"]),
  // Fashion
  C("fashion", "fashion-weeks", "Fashion weeks", ["fashion week"]),
  C("fashion", "runway", "Runway shows", ["runway"]),
  // Culture
  C("culture", "heritage", "Heritage celebrations", ["heritage"]),
  C("culture", "traditional", "Traditional celebrations", ["traditional"]),
];

export const CATEGORIES: Category[] = [...GROUPS, ...SUBCATEGORIES];

const bySlug = new Map(CATEGORIES.map((c) => [c.slug, c]));

export function getCategory(slug: string): Category | undefined {
  return bySlug.get(slug);
}

/** Walk up the tree to the top-level group. Works for any depth. */
export function groupOf(slug: string): string {
  let c = bySlug.get(slug);
  const seen = new Set<string>();
  while (c?.parent && !seen.has(c.slug)) {
    seen.add(c.slug);
    c = bySlug.get(c.parent);
  }
  return c?.slug ?? "other";
}

export function childrenOf(slug: string): Category[] {
  return CATEGORIES.filter((c) => c.parent === slug && c.active);
}

/** All descendants (inclusive) — used so filtering "music" matches "jazz". */
export function descendantsOf(slug: string): Set<string> {
  const out = new Set<string>([slug]);
  let frontier = [slug];
  while (frontier.length) {
    const next: string[] = [];
    for (const s of frontier)
      for (const c of CATEGORIES)
        if (c.parent === s && !out.has(c.slug)) {
          out.add(c.slug);
          next.push(c.slug);
        }
    frontier = next;
  }
  return out;
}

/** Globe "modes" — preset combinations of top-level groups. */
export const GLOBE_MODES: { id: string; label: string; groups: string[] }[] = [
  { id: "all", label: "Everything", groups: [] },
  { id: "music", label: "Music", groups: ["music", "nightlife"] },
  { id: "sports", label: "Sports", groups: ["sports"] },
  { id: "stage", label: "Theatre & Entertainment", groups: ["theatre", "comedy", "cinema"] },
  { id: "festivals", label: "Festivals & Culture", groups: ["festivals", "culture", "food-drink", "fashion"] },
  { id: "business", label: "Conferences & Business", groups: ["conferences", "technology", "education"] },
  { id: "exhibitions", label: "Exhibitions & Attractions", groups: ["exhibitions", "attractions"] },
  { id: "family", label: "Family & Activities", groups: ["family", "outdoor"] },
];

/** Concrete hex colours for WebGL (CSS vars can't be read by shaders). */
export const GROUP_HEX: Record<string, string> = {
  music: "#7B4DFF",
  nightlife: "#A23BEC",
  sports: "#0A9BD6",
  theatre: "#F0475A",
  comedy: "#F26B5B",
  cinema: "#E8890C",
  festivals: "#F59A0B",
  culture: "#C98A12",
  "food-drink": "#F06A1D",
  fashion: "#E0398C",
  conferences: "#3B5BDB",
  technology: "#2F7BEA",
  education: "#4C6EF5",
  exhibitions: "#0FA979",
  outdoor: "#2F9E44",
  attractions: "#D6336C",
  family: "#E5A800",
  other: "#6F819C",
};

/** Marker shape per group, so colour is never the only distinguishing cue. */
export const GROUP_SHAPE: Record<string, "diamond" | "circle" | "triangle" | "square" | "hex"> = {
  music: "diamond",
  nightlife: "diamond",
  sports: "circle",
  theatre: "triangle",
  comedy: "triangle",
  cinema: "triangle",
  festivals: "hex",
  culture: "hex",
  "food-drink": "hex",
  fashion: "hex",
  conferences: "square",
  technology: "square",
  education: "square",
  exhibitions: "circle",
  outdoor: "circle",
  attractions: "hex",
  family: "diamond",
  other: "circle",
};
