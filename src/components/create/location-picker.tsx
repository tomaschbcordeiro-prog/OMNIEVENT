"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Loader2, LocateFixed, MapPin, Search } from "lucide-react";
import { buildStyle, DEFAULT_LAYERS } from "@/lib/map/style";

/** What the questionnaire learns from a point on the map. */
export interface PickedPlace {
  lat: number;
  lng: number;
  name?: string;
  address?: string;
  city?: string;
  country?: string;
  countryCode?: string;
}

interface SearchHit {
  id: string;
  name: string;
  context: string;
  kind: string;
  lat: number;
  lng: number;
  countryCode?: string;
}

/** Street, city and country for a point, from the reverse geocoder. */
async function describe(lat: number, lng: number): Promise<Omit<PickedPlace, "lat" | "lng">> {
  try {
    const r = await fetch(`/api/geocode/reverse?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`);
    if (!r.ok) return {};
    const { place } = (await r.json()) as { place: { hierarchy: { kind: string; name: string }[] } };
    // The first kind in the list that the place has: a city before its district or region.
    const find = (...kinds: string[]) => kinds.map((k) => place.hierarchy.find((h) => h.kind === k)?.name).find(Boolean);
    return {
      name: find("poi", "building"),
      address: find("street", "address"),
      city: find("city", "town", "village", "place", "district", "locality", "state", "region"),
      country: find("country"),
    };
  } catch {
    return {};
  }
}

/**
 * Where the event is: search an address or place, or tap the map, then drag the pin to the exact
 * spot. Every move fills in the street, city and country.
 */
export function LocationPicker({ value, onPick, initialQuery }: { value: { lat: number; lng: number } | null; onPick: (p: PickedPlace) => void; /** Searched at once (from a pasted announcement). */ initialQuery?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const latest = useRef(onPick);
  latest.current = onPick;
  const [q, setQ] = useState(value ? "" : (initialQuery ?? ""));
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState("");
  const [active, setActive] = useState(-1);

  // Places matching what's typed (after a short pause).
  useEffect(() => {
    if (q.trim().length < 3) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const c = map.current?.getCenter();
        const near = c && map.current!.getZoom() > 4 ? `&lat=${c.lat.toFixed(3)}&lng=${c.lng.toFixed(3)}` : "";
        const r = await fetch(`/api/geocode?q=${encodeURIComponent(q.trim())}&limit=6${near}`, { signal: ctrl.signal });
        const j = r.ok ? ((await r.json()) as { results: SearchHit[] }) : { results: [] };
        setHits(j.results);
        setOpen(true);
        setActive(-1);
      } catch {
        // typing on: a newer search replaces this one
      } finally {
        setSearching(false);
      }
    }, 320);
    return () => (clearTimeout(t), ctrl.abort());
  }, [q]);

  /** Move the pin (and the view) to a point, then describe it. */
  const place = async (lat: number, lng: number, extra: Partial<PickedPlace> = {}, zoom = 16) => {
    const m = map.current;
    if (m) {
      putPin(lat, lng);
      m.flyTo({ center: [lng, lat], zoom: Math.max(m.getZoom(), zoom), duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900 });
    }
    latest.current({ lat, lng, ...extra });
    const d = await describe(lat, lng);
    latest.current({ lat, lng, ...d, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) });
  };

  const putPin = (lat: number, lng: number) => {
    const m = map.current;
    if (!m) return;
    if (!pin.current) {
      void import("maplibre-gl").then(({ default: ml }) => {
        const el = document.createElement("div");
        el.className = "create-pin";
        el.setAttribute("aria-label", "Event location. Drag to adjust.");
        el.append(document.createElement("span"));
        pin.current = new ml.Marker({ element: el, anchor: "bottom", draggable: true }).setLngLat([lng, lat]).addTo(m);
        pin.current.on("dragend", () => {
          const p = pin.current!.getLngLat();
          void place(p.lat, p.lng, {}, m.getZoom());
        });
      });
    } else pin.current.setLngLat([lng, lat]);
  };

  // The map itself: a flat street map; a tap moves the pin there.
  useEffect(() => {
    let gone = false;
    void import("maplibre-gl").then(({ default: ml }) => {
      if (gone || !box.current) return;
      const m = new ml.Map({
        container: box.current,
        style: buildStyle({ base: "map", layers: { ...DEFAULT_LAYERS, terrain: false, density: false, events: false, night: false } }),
        center: value ? [value.lng, value.lat] : [-9.14, 38.72],
        zoom: value ? 15.5 : 1.6,
        attributionControl: { compact: true },
        cooperativeGestures: true,
      });
      m.on("style.load", () => m.setProjection({ type: "mercator" }));
      m.on("click", (e) => void place(e.lngLat.lat, e.lngLat.lng, {}, m.getZoom()));
      map.current = m;
      if (value) m.once("load", () => putPin(value.lat, value.lng));
    });
    return () => {
      gone = true;
      pin.current?.remove();
      pin.current = null;
      map.current?.remove();
      map.current = null;
    };
    // The map is made once; later points move the pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (h: SearchHit) => {
    setOpen(false);
    setQ(h.name);
    const poi = !["city", "town", "village", "country", "state", "region", "district", "street", "coordinates", "postcode"].includes(h.kind);
    void place(h.lat, h.lng, { countryCode: h.countryCode, name: poi ? h.name : undefined }, h.kind === "city" || h.kind === "town" ? 13 : 16);
  };

  const locate = () => {
    if (!navigator.geolocation) return setNote("Location isn't available in this browser.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setNote("");
        void place(p.coords.latitude, p.coords.longitude);
      },
      () => {
        setLocating(false);
        setNote("Location permission wasn't given. Search for the address instead.");
      },
      { timeout: 10000, maximumAge: 300000 },
    );
  };

  return (
    <div className="grid gap-3">
      <div className="relative">
        <label htmlFor="ce-place-search" className="sr-only">Search for the address or place</label>
        <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" aria-hidden />
        <input
          id="ce-place-search"
          className="field w-full !pl-10 !pr-28 !h-12"
          placeholder="Search an address, venue or place"
          value={q}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls="ce-place-list"
          aria-activedescendant={active >= 0 ? `ce-hit-${active}` : undefined}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || !hits.length) return;
            if (e.key === "Escape") return setOpen(false);
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && !(e.key === "Enter" && active >= 0)) return;
            e.preventDefault();
            if (e.key === "ArrowDown") setActive((a) => Math.min(hits.length - 1, a + 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
            else choose(hits[active]);
          }}
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {searching && <Loader2 size={15} className="animate-spin text-text-3" aria-hidden />}
          <button type="button" className="btn btn-ghost btn-sm" onClick={locate} disabled={locating} title="Use where I am now">
            {locating ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <LocateFixed size={15} aria-hidden />}
            <span className="max-sm:sr-only">Near me</span>
          </button>
        </div>
        {open && hits.length > 0 && (
          <ul id="ce-place-list" role="listbox" className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-[var(--radius-m)] border border-line bg-panel shadow-xl panel-in">
            {hits.map((h, i) => (
              <li
                key={h.id}
                id={`ce-hit-${i}`}
                role="option"
                aria-selected={i === active}
                className={`flex cursor-pointer items-start gap-2.5 px-3.5 py-2.5 ${i === active ? "bg-cyan/10" : "hover:bg-panel-2"}`}
                onMouseDown={(e) => (e.preventDefault(), choose(h))}
              >
                <MapPin size={15} className="mt-0.5 shrink-0 text-text-3" aria-hidden />
                <span className="min-w-0">
                  <span className="block font-medium truncate">{h.name}</span>
                  <span className="block t-micro text-text-3 truncate">{h.context}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {note && <p className="t-small text-warn">{note}</p>}
      <div className="relative overflow-hidden rounded-[var(--radius-l)] border border-line">
        <div ref={box} className="h-64 sm:h-80 w-full bg-panel-2" />
        {!value && (
          <p className="pointer-events-none absolute inset-x-3 bottom-3 rounded-full bg-panel/90 px-3 py-1.5 text-center t-small font-medium shadow backdrop-blur">
            Search above, or tap the map where it happens
          </p>
        )}
      </div>
    </div>
  );
}
