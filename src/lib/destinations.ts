import type { Destination } from "./types";

/**
 * Geographic reference data (real places, approximate city-centre coordinates).
 * This is geography, not event data — it is safe to ship with the app.
 * In production this table is seeded from a gazetteer (e.g. GeoNames) into Postgres.
 */

type CityRow = [
  id: string,
  name: string,
  countryCode: string,
  lat: number,
  lng: number,
  tz: string,
  aliases?: string[],
];

export const CONTINENTS: Destination[] = [
  { id: "europe", slug: "europe", name: "Europe", kind: "continent", lat: 50, lng: 12 },
  { id: "north-america", slug: "north-america", name: "North America", kind: "continent", lat: 40, lng: -98 },
  { id: "south-america", slug: "south-america", name: "South America", kind: "continent", lat: -18, lng: -60, southern: true },
  { id: "asia", slug: "asia", name: "Asia", kind: "continent", lat: 30, lng: 100 },
  { id: "africa", slug: "africa", name: "Africa", kind: "continent", lat: 4, lng: 20 },
  { id: "oceania", slug: "oceania", name: "Oceania", kind: "continent", lat: -27, lng: 140, southern: true },
];

type CountryRow = [code: string, name: string, continent: string, currency: string, lat: number, lng: number, aliases?: string[]];

const COUNTRY_ROWS: CountryRow[] = [
  ["PT", "Portugal", "europe", "EUR", 39.6, -8.0],
  ["ES", "Spain", "europe", "EUR", 40.2, -3.6, ["españa"]],
  ["FR", "France", "europe", "EUR", 46.6, 2.4],
  ["GB", "United Kingdom", "europe", "GBP", 54.0, -2.5, ["uk", "england", "britain", "great britain", "scotland"]],
  ["IE", "Ireland", "europe", "EUR", 53.4, -8.0],
  ["DE", "Germany", "europe", "EUR", 51.1, 10.4, ["deutschland"]],
  ["NL", "Netherlands", "europe", "EUR", 52.2, 5.3, ["holland"]],
  ["BE", "Belgium", "europe", "EUR", 50.6, 4.6],
  ["IT", "Italy", "europe", "EUR", 42.8, 12.5, ["italia"]],
  ["CH", "Switzerland", "europe", "CHF", 46.8, 8.2],
  ["AT", "Austria", "europe", "EUR", 47.6, 14.1],
  ["DK", "Denmark", "europe", "DKK", 56.0, 10.0],
  ["SE", "Sweden", "europe", "SEK", 62.0, 15.0],
  ["NO", "Norway", "europe", "NOK", 61.0, 9.0],
  ["FI", "Finland", "europe", "EUR", 64.0, 26.0],
  ["PL", "Poland", "europe", "PLN", 52.0, 19.4],
  ["CZ", "Czechia", "europe", "CZK", 49.8, 15.5, ["czech republic"]],
  ["HU", "Hungary", "europe", "HUF", 47.2, 19.4],
  ["GR", "Greece", "europe", "EUR", 39.1, 22.0],
  ["TR", "Türkiye", "europe", "TRY", 39.0, 35.0, ["turkey"]],
  ["MC", "Monaco", "europe", "EUR", 43.74, 7.42],
  ["US", "United States", "north-america", "USD", 39.8, -98.6, ["usa", "us", "america", "united states of america"]],
  ["CA", "Canada", "north-america", "CAD", 56.1, -106.3],
  ["MX", "Mexico", "north-america", "MXN", 23.6, -102.5, ["méxico"]],
  ["BR", "Brazil", "south-america", "BRL", -14.2, -51.9, ["brasil"]],
  ["AR", "Argentina", "south-america", "ARS", -38.4, -63.6],
  ["CL", "Chile", "south-america", "CLP", -35.7, -71.5],
  ["CO", "Colombia", "south-america", "COP", 4.6, -74.3],
  ["PE", "Peru", "south-america", "PEN", -9.2, -75.0],
  ["JP", "Japan", "asia", "JPY", 36.2, 138.3],
  ["KR", "South Korea", "asia", "KRW", 36.5, 127.8, ["korea"]],
  ["CN", "China", "asia", "CNY", 35.9, 104.2],
  ["HK", "Hong Kong", "asia", "HKD", 22.32, 114.17],
  ["TW", "Taiwan", "asia", "TWD", 23.7, 121.0],
  ["SG", "Singapore", "asia", "SGD", 1.35, 103.82],
  ["TH", "Thailand", "asia", "THB", 15.9, 100.99],
  ["ID", "Indonesia", "asia", "IDR", -0.8, 113.9],
  ["PH", "Philippines", "asia", "PHP", 12.9, 121.8],
  ["IN", "India", "asia", "INR", 20.6, 79.0],
  ["AE", "United Arab Emirates", "asia", "AED", 23.4, 53.8, ["uae", "emirates"]],
  ["IL", "Israel", "asia", "ILS", 31.0, 34.9],
  ["ZA", "South Africa", "africa", "ZAR", -30.6, 22.9],
  ["EG", "Egypt", "africa", "EGP", 26.8, 30.8],
  ["MA", "Morocco", "africa", "MAD", 31.8, -7.1],
  ["KE", "Kenya", "africa", "KES", -0.02, 37.9],
  ["NG", "Nigeria", "africa", "NGN", 9.1, 8.7],
  ["GH", "Ghana", "africa", "GHS", 7.9, -1.0],
  ["AU", "Australia", "oceania", "AUD", -25.3, 133.8],
  ["NZ", "New Zealand", "oceania", "NZD", -40.9, 174.9],
];

const CITY_ROWS: CityRow[] = [
  ["lisbon", "Lisbon", "PT", 38.7223, -9.1393, "Europe/Lisbon", ["lisboa"]],
  ["porto", "Porto", "PT", 41.1579, -8.6291, "Europe/Lisbon", ["oporto"]],
  ["madrid", "Madrid", "ES", 40.4168, -3.7038, "Europe/Madrid"],
  ["barcelona", "Barcelona", "ES", 41.3874, 2.1686, "Europe/Madrid"],
  ["seville", "Seville", "ES", 37.3891, -5.9845, "Europe/Madrid", ["sevilla"]],
  ["valencia", "Valencia", "ES", 39.4699, -0.3763, "Europe/Madrid"],
  ["paris", "Paris", "FR", 48.8566, 2.3522, "Europe/Paris"],
  ["lyon", "Lyon", "FR", 45.764, 4.8357, "Europe/Paris"],
  ["marseille", "Marseille", "FR", 43.2965, 5.3698, "Europe/Paris"],
  ["london", "London", "GB", 51.5072, -0.1276, "Europe/London"],
  ["manchester", "Manchester", "GB", 53.4808, -2.2426, "Europe/London"],
  ["edinburgh", "Edinburgh", "GB", 55.9533, -3.1883, "Europe/London"],
  ["dublin", "Dublin", "IE", 53.3498, -6.2603, "Europe/Dublin"],
  ["berlin", "Berlin", "DE", 52.52, 13.405, "Europe/Berlin"],
  ["munich", "Munich", "DE", 48.1351, 11.582, "Europe/Berlin", ["münchen", "munchen"]],
  ["hamburg", "Hamburg", "DE", 53.5511, 9.9937, "Europe/Berlin"],
  ["amsterdam", "Amsterdam", "NL", 52.3676, 4.9041, "Europe/Amsterdam"],
  ["brussels", "Brussels", "BE", 50.8503, 4.3517, "Europe/Brussels", ["bruxelles"]],
  ["rome", "Rome", "IT", 41.9028, 12.4964, "Europe/Rome", ["roma"]],
  ["milan", "Milan", "IT", 45.4642, 9.19, "Europe/Rome", ["milano"]],
  ["venice", "Venice", "IT", 45.4408, 12.3155, "Europe/Rome", ["venezia"]],
  ["zurich", "Zurich", "CH", 47.3769, 8.5417, "Europe/Zurich", ["zürich"]],
  ["vienna", "Vienna", "AT", 48.2082, 16.3738, "Europe/Vienna", ["wien"]],
  ["copenhagen", "Copenhagen", "DK", 55.6761, 12.5683, "Europe/Copenhagen"],
  ["stockholm", "Stockholm", "SE", 59.3293, 18.0686, "Europe/Stockholm"],
  ["oslo", "Oslo", "NO", 59.9139, 10.7522, "Europe/Oslo"],
  ["helsinki", "Helsinki", "FI", 60.1699, 24.9384, "Europe/Helsinki"],
  ["warsaw", "Warsaw", "PL", 52.2297, 21.0122, "Europe/Warsaw"],
  ["prague", "Prague", "CZ", 50.0755, 14.4378, "Europe/Prague"],
  ["budapest", "Budapest", "HU", 47.4979, 19.0402, "Europe/Budapest"],
  ["athens", "Athens", "GR", 37.9838, 23.7275, "Europe/Athens"],
  ["istanbul", "Istanbul", "TR", 41.0082, 28.9784, "Europe/Istanbul"],
  ["monaco", "Monaco", "MC", 43.7384, 7.4246, "Europe/Monaco"],
  ["new-york", "New York", "US", 40.7128, -74.006, "America/New_York", ["nyc", "new york city", "manhattan", "brooklyn"]],
  ["los-angeles", "Los Angeles", "US", 34.0522, -118.2437, "America/Los_Angeles", ["la"]],
  ["chicago", "Chicago", "US", 41.8781, -87.6298, "America/Chicago"],
  ["miami", "Miami", "US", 25.7617, -80.1918, "America/New_York"],
  ["las-vegas", "Las Vegas", "US", 36.1699, -115.1398, "America/Los_Angeles", ["vegas"]],
  ["san-francisco", "San Francisco", "US", 37.7749, -122.4194, "America/Los_Angeles", ["sf"]],
  ["austin", "Austin", "US", 30.2672, -97.7431, "America/Chicago"],
  ["nashville", "Nashville", "US", 36.1627, -86.7816, "America/Chicago"],
  ["new-orleans", "New Orleans", "US", 29.9511, -90.0715, "America/Chicago"],
  ["seattle", "Seattle", "US", 47.6062, -122.3321, "America/Los_Angeles"],
  ["boston", "Boston", "US", 42.3601, -71.0589, "America/New_York"],
  ["toronto", "Toronto", "CA", 43.6532, -79.3832, "America/Toronto"],
  ["montreal", "Montreal", "CA", 45.5019, -73.5674, "America/Toronto", ["montréal"]],
  ["vancouver", "Vancouver", "CA", 49.2827, -123.1207, "America/Vancouver"],
  ["mexico-city", "Mexico City", "MX", 19.4326, -99.1332, "America/Mexico_City", ["cdmx", "ciudad de méxico"]],
  ["guadalajara", "Guadalajara", "MX", 20.6597, -103.3496, "America/Mexico_City"],
  ["sao-paulo", "São Paulo", "BR", -23.5505, -46.6333, "America/Sao_Paulo", ["sao paulo"]],
  ["rio-de-janeiro", "Rio de Janeiro", "BR", -22.9068, -43.1729, "America/Sao_Paulo", ["rio"]],
  ["salvador", "Salvador", "BR", -12.9777, -38.5016, "America/Bahia"],
  ["brasilia", "Brasília", "BR", -15.7939, -47.8828, "America/Sao_Paulo", ["brasilia"]],
  ["belo-horizonte", "Belo Horizonte", "BR", -19.9167, -43.9345, "America/Sao_Paulo"],
  ["curitiba", "Curitiba", "BR", -25.4284, -49.2733, "America/Sao_Paulo"],
  ["porto-alegre", "Porto Alegre", "BR", -30.0346, -51.2177, "America/Sao_Paulo"],
  ["recife", "Recife", "BR", -8.0476, -34.877, "America/Recife"],
  ["fortaleza", "Fortaleza", "BR", -3.7319, -38.5267, "America/Fortaleza"],
  ["belem", "Belém", "BR", -1.4558, -48.4902, "America/Belem", ["belem"]],
  ["vitoria-es", "Vitória", "BR", -20.3155, -40.3128, "America/Sao_Paulo"],
  ["buenos-aires", "Buenos Aires", "AR", -34.6037, -58.3816, "America/Argentina/Buenos_Aires"],
  ["santiago", "Santiago", "CL", -33.4489, -70.6693, "America/Santiago"],
  ["bogota", "Bogotá", "CO", 4.711, -74.0721, "America/Bogota", ["bogota"]],
  ["lima", "Lima", "PE", -12.0464, -77.0428, "America/Lima"],
  ["tokyo", "Tokyo", "JP", 35.6762, 139.6503, "Asia/Tokyo"],
  ["osaka", "Osaka", "JP", 34.6937, 135.5023, "Asia/Tokyo"],
  ["seoul", "Seoul", "KR", 37.5665, 126.978, "Asia/Seoul"],
  ["shanghai", "Shanghai", "CN", 31.2304, 121.4737, "Asia/Shanghai"],
  ["beijing", "Beijing", "CN", 39.9042, 116.4074, "Asia/Shanghai"],
  ["hong-kong", "Hong Kong", "HK", 22.3193, 114.1694, "Asia/Hong_Kong"],
  ["taipei", "Taipei", "TW", 25.033, 121.5654, "Asia/Taipei"],
  ["singapore", "Singapore", "SG", 1.3521, 103.8198, "Asia/Singapore"],
  ["bangkok", "Bangkok", "TH", 13.7563, 100.5018, "Asia/Bangkok"],
  ["bali", "Denpasar (Bali)", "ID", -8.6705, 115.2126, "Asia/Makassar", ["bali", "denpasar"]],
  ["manila", "Manila", "PH", 14.5995, 120.9842, "Asia/Manila"],
  ["mumbai", "Mumbai", "IN", 19.076, 72.8777, "Asia/Kolkata", ["bombay"]],
  ["delhi", "New Delhi", "IN", 28.6139, 77.209, "Asia/Kolkata", ["delhi"]],
  ["bengaluru", "Bengaluru", "IN", 12.9716, 77.5946, "Asia/Kolkata", ["bangalore"]],
  ["dubai", "Dubai", "AE", 25.2048, 55.2708, "Asia/Dubai"],
  ["tel-aviv", "Tel Aviv", "IL", 32.0853, 34.7818, "Asia/Jerusalem"],
  ["cape-town", "Cape Town", "ZA", -33.9249, 18.4241, "Africa/Johannesburg"],
  ["johannesburg", "Johannesburg", "ZA", -26.2041, 28.0473, "Africa/Johannesburg"],
  ["cairo", "Cairo", "EG", 30.0444, 31.2357, "Africa/Cairo"],
  ["marrakech", "Marrakech", "MA", 31.6295, -7.9811, "Africa/Casablanca", ["marrakesh"]],
  ["nairobi", "Nairobi", "KE", -1.2921, 36.8219, "Africa/Nairobi"],
  ["lagos", "Lagos", "NG", 6.5244, 3.3792, "Africa/Lagos"],
  ["accra", "Accra", "GH", 5.6037, -0.187, "Africa/Accra"],
  ["sydney", "Sydney", "AU", -33.8688, 151.2093, "Australia/Sydney"],
  ["melbourne", "Melbourne", "AU", -37.8136, 144.9631, "Australia/Melbourne"],
  ["brisbane", "Brisbane", "AU", -27.4698, 153.0251, "Australia/Brisbane"],
  ["perth", "Perth", "AU", -31.9505, 115.8605, "Australia/Perth"],
  ["auckland", "Auckland", "NZ", -36.8485, 174.7633, "Pacific/Auckland"],
];

export const COUNTRIES: Destination[] = COUNTRY_ROWS.map(([code, name, continent, currency, lat, lng, aliases]) => ({
  id: code.toLowerCase(),
  slug: slugify(name),
  name,
  kind: "country",
  countryCode: code,
  continent,
  parentId: continent,
  currency,
  lat,
  lng,
  aliases,
  southern: lat < -5,
}));

const countryByCode = new Map(COUNTRIES.map((c) => [c.countryCode!, c]));

export const CITIES: Destination[] = CITY_ROWS.map(([id, name, cc, lat, lng, tz, aliases]) => {
  const country = countryByCode.get(cc)!;
  return {
    id,
    slug: id,
    name,
    kind: "city",
    countryCode: cc,
    country: country.name,
    continent: country.continent,
    parentId: country.id,
    lat,
    lng,
    timeZone: tz,
    currency: country.currency,
    aliases,
    southern: lat < -5,
  };
});

export const ALL_DESTINATIONS: Destination[] = [...CONTINENTS, ...COUNTRIES, ...CITIES];

const destById = new Map<string, Destination>();
for (const d of ALL_DESTINATIONS) {
  destById.set(d.id, d);
  destById.set(d.slug, d);
}

export function getDestination(idOrSlug: string): Destination | undefined {
  return destById.get(idOrSlug);
}

export function getCountry(code: string): Destination | undefined {
  return countryByCode.get(code.toUpperCase());
}

export function citiesIn(dest: Destination): Destination[] {
  if (dest.kind === "city") return [dest];
  if (dest.kind === "country") return CITIES.filter((c) => c.countryCode === dest.countryCode);
  if (dest.kind === "continent") return CITIES.filter((c) => c.continent === dest.id);
  return [];
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
