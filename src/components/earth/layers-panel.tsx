"use client";

import { Info, X } from "lucide-react";
import type { BaseStyle, LayerKey, LayerState } from "@/lib/map/style";
import { PROVIDER_INFO, MAPTILER_KEY } from "@/lib/map/style";

const TOGGLES: { key: LayerKey; label: string; hint?: string }[] = [
  { key: "events", label: "Events" },
  { key: "density", label: "Event density", hint: "Heat map of listed events" },
  { key: "labels", label: "Place names" },
  { key: "roads", label: "Roads and streets" },
  { key: "borders", label: "Borders" },
  { key: "poi", label: "Places", hint: "Restaurants, museums, monuments, parks… from street level" },
  { key: "buildings", label: "3D buildings", hint: "From zoom 14, where mapped" },
  { key: "terrain", label: "3D terrain", hint: "Mountains and valleys in relief" },
  { key: "night", label: "Day and night", hint: "Live position of the sun" },
];

export function LayersPanel({
  base, layers, onBase, onLayer, onClose, space, onSpace, onLegend,
}: {
  base: BaseStyle;
  layers: LayerState;
  onBase: (b: BaseStyle) => void;
  onLayer: (k: LayerKey, on: boolean) => void;
  onClose: () => void;
  /** Space view: the starry sky and the real night side. */
  space?: boolean;
  onSpace?: (on: boolean) => void;
  /** Opens the marker legend. */
  onLegend?: () => void;
}) {
  return (
    <div role="dialog" aria-label="Map layers" className="surface-float rounded-[var(--radius-l)] w-[290px] max-h-[70dvh] overflow-auto scroll-thin p-3 panel-in">
      <div className="flex items-center justify-between mb-2">
        <p className="t-h3">Map</p>
        <button className="btn btn-ghost btn-icon btn-sm" aria-label="Close layers" onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Map style">
        {([
          ["map", "Day map", "linear-gradient(135deg,#9fd6f5 0%,#9fd6f5 38%,#e6f0dc 40%,#cfe6b8 70%,#ffe3a0 72%,#e6f0dc 75%)"],
          ["satellite", "Satellite", "linear-gradient(135deg,#2c6e9c,#4f8f6a 50%,#b9a77c 75%,#2c6e9c)"],
          ["lights", "Night lights", "radial-gradient(circle at 30% 40%,#ffd36b 0 2px,transparent 3px),radial-gradient(circle at 62% 58%,#ffe9a8 0 1.5px,transparent 2.5px),radial-gradient(circle at 75% 30%,#ffc94d 0 2.5px,transparent 3.5px),radial-gradient(circle at 45% 75%,#ffd36b 0 1.5px,transparent 2.5px),linear-gradient(135deg,#050b26,#0d1640 60%,#162056)"],
        ] as const).map(([b, label, bg]) => (
          <button key={b} role="radio" aria-checked={base === b} onClick={() => onBase(b)} className={`rounded-[var(--radius-m)] border p-1.5 text-left ${base === b ? "border-cyan" : "border-line-strong hover:border-cyan/50"}`}>
            <span className="block h-12 rounded-[6px]" style={{ background: bg }} aria-hidden />
            <span className="block t-small mt-1 px-0.5">{label}</span>
          </button>
        ))}
      </div>
      <ul className="mt-3 grid">
        {onSpace && (
          <li className="border-b border-line pb-1.5 mb-1.5">
            <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
              <span>
                <span className="block t-small font-medium">✨ Space view</span>
                <span className="block t-micro text-text-3">A starry sky and the real night side</span>
              </span>
              <input type="checkbox" role="switch" className="h-4 w-4 accent-[var(--cyan)]" checked={!!space} onChange={(e) => onSpace(e.target.checked)} />
            </label>
          </li>
        )}
        {TOGGLES.map((t) => (
          <li key={t.key}>
            <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
              <span>
                <span className="block t-small">{t.label}</span>
                {t.hint && <span className="block t-micro text-text-3">{t.hint}</span>}
              </span>
              <input type="checkbox" role="switch" className="h-4 w-4 accent-[var(--cyan)]" checked={layers[t.key]} onChange={(e) => onLayer(t.key, e.target.checked)} />
            </label>
          </li>
        ))}
      </ul>
      {onLegend && (
        <button type="button" className="btn btn-ghost btn-sm mt-2 -ml-2" onClick={onLegend}>
          <Info size={14} aria-hidden /> What the markers mean
        </button>
      )}
      <p className="t-micro text-text-3 mt-2 border-t border-line pt-2">
        Imagery: {PROVIDER_INFO.satellite.name}. Streets: {PROVIDER_INFO.vector}. Terrain: {PROVIDER_INFO.terrain}.
        {!MAPTILER_KEY && " Satellite detail is limited to city scale; street-level imagery needs a MapTiler key."}
      </p>
    </div>
  );
}
