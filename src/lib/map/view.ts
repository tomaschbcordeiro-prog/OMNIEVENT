import { haversineKm } from "../geo";

/** Shared camera state for the 3D globe and the 2D map (one MapLibre instance, two projections). */
export interface CameraState {
  lat: number;
  lng: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface ViewState extends CameraState {
  /** [west, south, east, north] of the visible area. */
  bounds?: [number, number, number, number];
}

export const HOME: CameraState = { lat: 28, lng: -12, zoom: 1.85, pitch: 0, bearing: 0 };

/** Event-cluster cell size (degrees) for a zoom level; 0 = group by venue. */
export function cellForZoom(z: number): number {
  if (z < 2) return 12;
  if (z < 3) return 7;
  if (z < 4.5) return 3.5;
  if (z < 6) return 1.2;
  if (z < 9) return 0.25;
  return 0;
}

/** Radius (km) covering the visible area, or undefined for whole-planet views. */
export function viewRadiusKm(v: ViewState): number | undefined {
  if (v.zoom < 3 || !v.bounds) return undefined;
  const [w, s, e, n] = v.bounds;
  const r = Math.max(haversineKm(v.lat, v.lng, n, e), haversineKm(v.lat, v.lng, s, w), haversineKm(v.lat, v.lng, n, w), haversineKm(v.lat, v.lng, s, e));
  return Math.min(20000, Math.max(1, r * 1.15));
}

/** Old share links used globe altitude (radii); convert to a map zoom. */
export const altToZoom = (alt: number) => Math.max(0.5, Math.min(18, Math.log2(2.6 / Math.max(alt, 0.01)) + 1.2));

/** Typical zoom for a place type, used for click-to-zoom and search results. */
export function zoomForKind(kind?: string): number {
  switch (kind) {
    case "continent": return 2.6;
    case "country": return 4.6;
    case "state": case "region": return 6.5;
    case "county": return 8.5;
    case "city": return 11.2;
    case "town": return 12.5;
    case "district": case "suburb": case "quarter": case "neighbourhood": case "locality": return 14;
    case "village": case "hamlet": return 14;
    case "street": return 16.5;
    case "house": case "address": case "building": return 18;
    case "poi": case "venue": return 17;
    default: return 13;
  }
}

export function formatCoords(lat: number, lng: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`;
}
