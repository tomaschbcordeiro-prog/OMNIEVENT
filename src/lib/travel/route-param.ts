/**
 * A route in an address (the planner's `route=`): kept apart from the trip ideas so the planner
 * reads it without loading the places list.
 */

/**
 * The planner's address for an idea's stops: name, country, place, nights and the site's city,
 * for each stop. Community trips use it too.
 */
export function routeParam(stops: { name: string; cc?: string; lat: number; lng: number; nights: number; cityId?: string }[]): string {
  const clean = (s: string) => s.replace(/[,;|]/g, " ").trim().slice(0, 60);
  return stops.map((s) => [clean(s.name), s.cc ?? "", s.lat.toFixed(3), s.lng.toFixed(3), s.nights, s.cityId ?? ""].join(",")).join(";");
}
export function parseRouteParam(v: string): { name: string; countryCode?: string; lat: number; lng: number; nights: number; cityId?: string }[] {
  const out: { name: string; countryCode?: string; lat: number; lng: number; nights: number; cityId?: string }[] = [];
  for (const part of v.split(";").slice(0, 12)) {
    const [name, cc, lat, lng, nights, cityId] = part.split(",");
    const la = Number(lat);
    const ln = Number(lng);
    const k = Number(nights);
    if (!name?.trim() || !Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) continue;
    out.push({ name: name.trim().slice(0, 60), countryCode: /^[A-Z]{2}$/.test(cc ?? "") ? cc : undefined, lat: la, lng: ln, nights: Number.isInteger(k) && k >= 0 && k <= 60 ? k : 2, cityId: /^[a-z0-9-]{1,40}$/.test(cityId ?? "") ? cityId : undefined });
  }
  return out;
}

