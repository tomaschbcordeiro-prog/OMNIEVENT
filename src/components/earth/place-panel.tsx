"use client";

import { useEffect, useState } from "react";
import { X, MapPin, Ticket, ZoomIn, Undo2, Loader2, Copy, Check } from "lucide-react";
import { formatCoords, zoomForKind } from "@/lib/map/view";

export interface SelectedPlace {
  lat: number;
  lng: number;
  name?: string;
  kind?: string;
  context?: string;
  /** Zoom level that frames this place. */
  zoom?: number;
}

interface Reverse {
  hierarchy: { kind: string; name: string }[];
  label: string;
}

const KIND_LABEL: Record<string, string> = {
  country: "Country", state: "Region", region: "Region", county: "County", city: "City", town: "Town", village: "Village",
  district: "District", suburb: "Neighbourhood", quarter: "Neighbourhood", neighbourhood: "Neighbourhood", locality: "Locality",
  street: "Street", address: "Address", house: "Address", building: "Building", poi: "Place of interest", continent: "Continent",
  coordinates: "Coordinates", place: "Place", postal_code: "Postcode",
};

/**
 * Information about a selected point on the map. Hierarchy comes from reverse geocoding,
 * so every level (street → neighbourhood → city → country) is real and clickable.
 */
export function PlacePanel({
  place, canGoBack, onClose, onBack, onZoom, onEventsNear, onLevel,
}: {
  place: SelectedPlace;
  canGoBack: boolean;
  onClose: () => void;
  onBack: () => void;
  onZoom: () => void;
  onEventsNear: () => void;
  onLevel: (query: string, kind: string) => void;
}) {
  const [rev, setRev] = useState<Reverse | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    setRev(null);
    const t = setTimeout(() => {
      fetch(`/api/geocode/reverse?lat=${place.lat.toFixed(6)}&lng=${place.lng.toFixed(6)}`, { signal: ctrl.signal })
        .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => null))?.error?.message ?? `HTTP ${r.status}`))))
        .then((j) => (setRev(j.place), setState("ok")))
        .catch((e) => e.name !== "AbortError" && setState("error"));
    }, 150);
    return () => (clearTimeout(t), ctrl.abort());
  }, [place.lat, place.lng]);

  const title = place.name ?? rev?.hierarchy[0]?.name ?? (state === "loading" ? "Looking up this place" : "Selected location");
  const kind = place.kind ?? rev?.hierarchy[0]?.kind;
  const levels = (rev?.hierarchy ?? []).filter((h) => h.name !== title);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside aria-label="Selected place" className="absolute z-30 inset-x-0 bottom-0 lg:inset-auto lg:right-6 lg:top-[calc(var(--header-h)+0.5rem)] lg:w-[380px] surface-float rounded-t-[var(--radius-l)] lg:rounded-[var(--radius-l)] panel-in">
      <div className="lg:hidden mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
      <div className="p-4 grid gap-3">
        <div className="flex items-start gap-3">
          <MapPin size={18} className="text-cyan mt-1 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            {kind && <p className="t-micro text-text-3">{KIND_LABEL[kind] ?? kind.replace(/_/g, " ")}</p>}
            <h2 className="t-h2 break-words">{title}</h2>
            {(place.context || (rev && levels.length > 0)) && <p className="t-small text-text-2 mt-0.5">{place.context ?? levels.map((l) => l.name).join(", ")}</p>}
          </div>
          <button className="btn btn-ghost btn-icon btn-sm -mr-1" aria-label="Clear selected place" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="flex items-center gap-2 t-micro text-text-3 tnum">
          <span>{formatCoords(place.lat, place.lng)}</span>
          <button
            className="hover:text-text"
            aria-label="Copy coordinates"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                // clipboard blocked
              }
            }}
          >
            {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          </button>
        </div>

        {state === "loading" && !place.name && (
          <p className="t-small text-text-3 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Finding the address</p>
        )}
        {state === "error" && <p className="t-small text-text-3">Address lookup is unavailable right now. The coordinates above are exact.</p>}

        {levels.length > 0 && (
          <div>
            <p className="t-micro text-text-3 mb-1.5">Go to</p>
            <div className="flex flex-wrap gap-1.5">
              {levels.map((l, i) => (
                <button
                  key={`${l.kind}-${l.name}`}
                  className="chip"
                  onClick={() => onLevel([l.name, ...levels.slice(i + 1).filter((x) => x.kind === "country" || x.kind === "city").map((x) => x.name)].join(", "), l.kind)}
                  title={`Fly to ${l.name}`}
                >
                  {l.name}
                  <span className="text-text-3">{KIND_LABEL[l.kind] ?? l.kind}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button className="btn btn-primary btn-sm col-span-2" onClick={onEventsNear}>
            <Ticket size={14} aria-hidden /> Events near here
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onZoom}>
            <ZoomIn size={14} aria-hidden /> Zoom in
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onBack} disabled={!canGoBack}>
            <Undo2 size={14} aria-hidden /> Previous view
          </button>
        </div>
      </div>
    </aside>
  );
}

export { zoomForKind };
