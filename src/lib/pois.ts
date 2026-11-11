/**
 * Places on the map (from OpenStreetMap, as the map's own tiles carry them): restaurants,
 * museums, monuments, theatres, palaces, parks, hotels… sorted into a few kinds, each with a
 * colour, so they can be shown, picked and put on a trip.
 */
import type { PlanKind } from "./trip-plans";

export type PoiGroup = "food" | "drink" | "culture" | "sights" | "nature" | "sport" | "shop" | "stay" | "transport" | "service";

/** The map's place classes (OpenMapTiles), by kind. Anything else is a service. */
export const POI_CLASSES: Record<Exclude<PoiGroup, "service">, string[]> = {
  food: ["restaurant", "fast_food", "cafe", "bakery", "ice_cream", "food_court", "sushi"],
  drink: ["bar", "beer", "pub", "nightclub", "biergarten", "alcohol_shop"],
  culture: ["museum", "art_gallery", "theatre", "cinema", "music", "library", "arts_centre"],
  sights: ["attraction", "monument", "castle", "memorial", "place_of_worship", "town_hall", "viewpoint", "lighthouse", "zoo", "aquarium", "amusement_park", "fountain", "religious_christian", "religious_jewish", "religious_muslim"],
  nature: ["park", "garden", "campsite", "picnic_site", "playground", "dog_park", "beach", "mountain", "volcano", "wetland"],
  sport: ["stadium", "pitch", "swimming", "golf", "soccer", "tennis", "basketball", "baseball", "american_football", "skiing", "sports_centre", "cricket"],
  shop: ["shop", "grocery", "clothing_store", "gift", "florist", "furniture", "jewelry", "commercial", "butcher", "books"],
  stay: ["lodging", "hotel", "hostel", "guest_house", "motel"],
  transport: ["railway", "railway_metro", "railway_light", "airport", "ferry", "harbor", "aerialway"],
};

/** Services worth seeing up close (a pharmacy, a hospital, tourist information…); the rest of the map's small things (bins, bollards, parking) stay off. */
export const POI_SERVICES = ["pharmacy", "hospital", "information", "toilets", "post", "bank", "embassy", "police"];

/** Stops along a line are not places to go to. */
export const POI_SKIP_SUBCLASSES = ["bus_stop", "tram_stop", "platform", "stop_position", "halt"];

export const POI_COLOR: Record<PoiGroup, string> = {
  food: "#E5484D",
  drink: "#9333EA",
  culture: "#0A84C2",
  sights: "#C2650A",
  nature: "#2F9E44",
  sport: "#0F766E",
  shop: "#DB2777",
  stay: "#7B4DFF",
  transport: "#1463FF",
  service: "#6B7280",
};

export const POI_GROUP_LABEL: Record<PoiGroup, string> = {
  food: "Food",
  drink: "Drinks & nightlife",
  culture: "Culture",
  sights: "Sights",
  nature: "Parks & nature",
  sport: "Sport",
  shop: "Shops",
  stay: "Places to stay",
  transport: "Getting around",
  service: "Services",
};

export function poiGroup(cls?: string, sub?: string): PoiGroup {
  for (const [g, list] of Object.entries(POI_CLASSES) as [Exclude<PoiGroup, "service">, string[]][]) if ((sub && list.includes(sub)) || (cls && list.includes(cls))) return g;
  return "service";
}

const SPECIAL: Record<string, string> = {
  place_of_worship: "Place of worship",
  art_gallery: "Art gallery",
  arts_centre: "Arts centre",
  fast_food: "Fast food",
  ice_cream: "Ice cream",
  town_hall: "Town hall",
  alcohol_shop: "Wine & spirits",
  beer: "Beer bar",
  music: "Music venue",
  lodging: "Hotel",
  railway: "Station",
  railway_metro: "Metro",
  railway_light: "Tram",
  bus: "Bus station",
  harbor: "Harbour",
  aerialway: "Cable car",
  attraction: "Attraction",
  castle: "Castle",
};

/** What a place is, in words: its own kind when the map says ("Palace", "Cathedral"), else its class. */
export function poiLabel(cls?: string, sub?: string): string {
  const key = sub && sub !== cls && !/^(yes|no)$/.test(sub) ? sub : cls;
  if (!key) return "Place";
  return SPECIAL[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** The kind of trip plan a place makes: dinner at a restaurant, a visit to a museum… */
export function planKindForPoi(group: PoiGroup): PlanKind {
  switch (group) {
    case "food":
    case "drink":
      return "meal";
    case "culture":
    case "sights":
      return "visit";
    case "stay":
      return "stay";
    case "nature":
    case "sport":
    case "shop":
      return "activity";
    default:
      return "note";
  }
}

/** The colour of each class, as a map style expression. */
export function poiColorExpression(): unknown[] {
  const pairs: unknown[] = [];
  for (const [g, list] of Object.entries(POI_CLASSES) as [Exclude<PoiGroup, "service">, string[]][]) pairs.push(list, POI_COLOR[g]);
  return ["match", ["get", "class"], ...pairs, POI_COLOR.service];
}
