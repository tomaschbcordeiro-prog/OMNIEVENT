"use client";

import { ZoomIn } from "lucide-react";
import { POI_COLOR, POI_GROUPS, type PoiGroup } from "@/lib/pois";

const SHORT: Record<PoiGroup, string> = {
  food: "Food",
  drink: "Drinks",
  culture: "Culture",
  sights: "Sights",
  nature: "Parks",
  sport: "Sport",
  shop: "Shops",
  stay: "Hotels",
  transport: "Transport",
  service: "Services",
};

/**
 * The places on the map (restaurants, museums, monuments…): which kinds to see, once close
 * enough for them; from a city's distance, a way to get close enough.
 */
export function PlacesBar({ zoom, groups, onGroups, onZoomIn }: { zoom: number; groups: PoiGroup[]; onGroups: (g: PoiGroup[]) => void; onZoomIn: () => void }) {
  if (zoom < 10.5) return null;
  if (zoom < 14)
    return (
      <button type="button" className="places-hint press panel-in" onClick={onZoomIn}>
        <ZoomIn size={15} aria-hidden /> Zoom in to see restaurants, museums, monuments…
      </button>
    );
  const toggle = (g: PoiGroup) => onGroups(groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g]);
  return (
    <div className="places-bar panel-in" role="group" aria-label="Places on the map: which kinds to show">
      <span className="places-bar-label">Places</span>
      <button type="button" className="places-chip" aria-pressed={!groups.length} onClick={() => onGroups([])}>All</button>
      {POI_GROUPS.map((g) => (
        <button key={g} type="button" className="places-chip" aria-pressed={groups.includes(g)} style={{ "--k": POI_COLOR[g] } as React.CSSProperties} onClick={() => toggle(g)}>
          <span className="places-dot" aria-hidden /> {SHORT[g]}
        </button>
      ))}
    </div>
  );
}
