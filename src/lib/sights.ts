/**
 * A city's sights: the places Wikipedia knows round a point (castles, churches, museums,
 * viewpoints, squares, markets…), the best known first. Pure, so it can be tested; the
 * lookup is in the API route.
 */

export interface Sight {
  id: string;
  name: string;
  /** Wikipedia's few words about it ("Historic castle in Lisbon, Portugal"). */
  about?: string;
  lat: number;
  lng: number;
  image?: string;
  /** Its Wikipedia page. */
  url: string;
  /** Its kind as the map names places (museum, castle…), for its icon and colour. */
  cls: string;
}

export interface WikiPage {
  pageid: number;
  title: string;
  description?: string;
  length?: number;
  coordinates?: { lat: number; lon: number }[];
  thumbnail?: { source: string };
}

/** Whole words, letters with accents counting as letters ("Café"). */
const words = (alts: string) => new RegExp(`(?<![\\p{L}])(?:${alts})(?![\\p{L}])`, "iu");

// What makes an article a place to go to, and what doesn't (an event, a company, a station…).
const PLACE = words("church|cathedral|basilica|chapel|monastery|convent|abbey|mosque|synagogue|temple|castle|palace|fort(ress)?|museum|gallery|theat(re|er)|opera|concert hall|monument|memorial|statue|sculpture|fountain|square|plaza|park|garden|zoo|aquarium|tower|bridge|lift|elevator|funicular|viewpoint|lookout|belvedere|aqueduct|arch|gate|market|library|caf[eé]|restaurant|bar|beach|lighthouse|ruins?|neighbou?rhood|quarter|district|street|avenue|boulevard|promenade|landmark|building|mansion|house|hall|stadium|arena|cemetery|observatory");
const NOT_PLACE = words("former|demolished|destroyed|station|metro|railway accident|accident|derailment|battle|siege|timeline|history of|gendarmerie|police|company|retailer|club \\(|nightclub \\(|bank|hospital|school|university|faculty|embassy|ministry|government|party|newspaper|band|footballer|person|people|family|order|regiment|military unit|parish|municipality|freguesia|electoral");

const KIND: [RegExp, string][] = [
  [words("museum|gallery"), "museum"],
  [words("theat(re|er)|opera|concert hall|cinema"), "theatre"],
  [words("church|cathedral|basilica|chapel|monastery|convent|abbey|mosque|synagogue|temple"), "place_of_worship"],
  [words("castle|palace|fort(ress)?|mansion"), "castle"],
  [words("park|garden|zoo|aquarium|beach"), "park"],
  [words("caf[eé]|restaurant|bar"), "cafe"],
  [words("market"), "marketplace"],
  [words("library"), "library"],
  [words("stadium|arena"), "stadium"],
  [words("monument|memorial|statue|sculpture|fountain|arch"), "monument"],
];

/** The sights among Wikipedia's articles round a point: places only, the best known first. */
export function sightsFromWikipedia(pages: WikiPage[], limit = 24): Sight[] {
  const out: Sight[] = [];
  for (const p of [...pages].sort((a, b) => (b.length ?? 0) - (a.length ?? 0))) {
    const c = p.coordinates?.[0];
    const about = p.description ?? "";
    if (!c || !about || NOT_PLACE.test(about) || NOT_PLACE.test(p.title) || !PLACE.test(`${about} ${p.title}`)) continue;
    out.push({
      id: `wp${p.pageid}`,
      name: p.title.replace(/\s*\((?:[^)]*)\)$/, ""),
      about,
      lat: c.lat,
      lng: c.lon,
      image: p.thumbnail?.source,
      url: `https://en.wikipedia.org/?curid=${p.pageid}`,
      cls: KIND.find(([re]) => re.test(`${about} ${p.title}`))?.[1] ?? "attraction",
    });
    if (out.length >= limit) break;
  }
  return out;
}
