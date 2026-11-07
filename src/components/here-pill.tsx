"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Globe2, Loader2, LocateFixed, MapPin, Navigation, Search } from "lucide-react";
import type { Here } from "@/lib/here-shared";
import { toast } from "./toast";

type CityRow = { id: string; name: string; country: string; n: number };

let cityList: Promise<CityRow[]> | null = null;
const loadCities = () =>
  (cityList ??= fetch("/api/cities")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: { cities: CityRow[] }) => j.cities)
    .catch(() => {
      cityList = null;
      return [];
    }));

const strip = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

const SOURCE: Record<Here["source"], string> = {
  ip: "Found from your connection",
  gps: "From your device's location",
  chosen: "Chosen by you",
  any: "Showing the whole planet",
  none: "We couldn't tell where you are",
};

/** Changes "here" on the server (a cookie), then re-renders the page around it. */
export async function setHere(body: Record<string, unknown>): Promise<Here | null> {
  const r = await fetch("/api/here", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new Error(j?.error?.code ?? String(r.status));
  }
  return ((await r.json()) as { here: Here }).here;
}

/**
 * Where the site opens: a pill with the city ("📍 Lisbon") that opens a small panel to pick
 * another city, use the device's location, or see everywhere. `tone` matches the surface it
 * sits on. `onChange` lets a page react at once; the page also re-renders from the server.
 */
export function HerePill({ here, tone = "light", align = "left", onChange, label }: { here: Here; tone?: "light" | "glass" | "dark"; align?: "left" | "right"; onChange?: (h: Here) => void; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cities, setCities] = useState<CityRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Enter pressed before the list arrived: take the first match once it does.
  const enterSoon = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  // On phones the panel is a sheet over the whole page (above any toolbars).
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 639px)");
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadCities().then(setCities);
    window.setTimeout(() => input.current?.focus(), 0);
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const list = useMemo(() => {
    const t = strip(q.trim());
    const hits = t ? cities.filter((c) => strip(c.name).includes(t) || strip(c.country).startsWith(t)).sort((a, b) => Number(!strip(a.name).startsWith(t)) - Number(!strip(b.name).startsWith(t)) || b.n - a.n) : cities;
    return hits.slice(0, t ? 8 : 6);
  }, [cities, q]);

  useEffect(() => {
    if (!enterSoon.current || !list.length) return;
    enterSoon.current = false;
    const c = list[0];
    void apply(c.id, { city: c.id }, () => `Showing events in ${c.name}`);
    // Only when the list arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const apply = async (key: string, body: Record<string, unknown>, done: (h: Here) => string) => {
    setBusy(key);
    try {
      const h = await setHere(body);
      if (h) {
        onChange?.(h);
        toast({ title: done(h), emoji: h.city ? "📍" : "🌍" });
      }
      setOpen(false);
      setQ("");
      router.refresh();
    } catch (e) {
      toast({ title: String(e).includes("no_city_near") ? "No events listed near you yet" : "Couldn't change your location", body: String(e).includes("no_city_near") ? "Pick a city instead, or see everywhere." : "Try again in a moment.", emoji: "🧭" });
    } finally {
      setBusy(null);
    }
  };
  const precise = () => {
    if (!navigator.geolocation) return toast({ title: "Location isn't available in this browser", emoji: "🧭" });
    setBusy("gps");
    navigator.geolocation.getCurrentPosition(
      (p) => void apply("gps", { lat: p.coords.latitude, lng: p.coords.longitude }, (h) => `Showing events near ${h.city?.name}`),
      () => {
        setBusy(null);
        toast({ title: "Location permission wasn't given", body: "Pick your city from the list instead.", emoji: "🧭" });
      },
      { timeout: 10000, maximumAge: 600000 },
    );
  };

  const name = here.city?.name ?? (here.source === "any" ? "Everywhere" : "Set your city");
  const Icon = here.source === "gps" ? Navigation : here.city ? MapPin : Globe2;
  const sheet = (
    <div ref={panel} role="dialog" aria-label="Your location" className={`here-panel panel-in ${align === "right" ? "right-0" : "left-0"}`}>
      <p className="t-micro text-text-3">{SOURCE[here.source]}</p>
      <p className="font-semibold mt-0.5">{here.city ? `${here.city.name}, ${here.city.country}` : name}</p>
      <div className="relative mt-3">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" aria-hidden />
        <input
          ref={input}
          className="field !h-10 !pl-9 w-full"
          placeholder="Another city"
          value={q}
          role="combobox"
          aria-expanded={list.length > 0}
          aria-controls="here-list"
          aria-activedescendant={list[active] ? `here-${list[active].id}` : undefined}
          autoComplete="off"
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(list.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && !cities.length && q.trim()) {
              e.preventDefault();
              enterSoon.current = true;
            } else if (e.key === "Enter" && list[active]) {
              e.preventDefault();
              const c = list[active];
              void apply(c.id, { city: c.id }, () => `Showing events in ${c.name}`);
            }
          }}
        />
      </div>
      <ul id="here-list" role="listbox" aria-label="Cities" className="mt-1.5 max-h-60 overflow-auto scroll-thin">
        {list.map((c, i) => (
          <li key={c.id} id={`here-${c.id}`} role="option" aria-selected={i === active}>
            <button type="button" className={`here-row ${i === active ? "is-active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => void apply(c.id, { city: c.id }, () => `Showing events in ${c.name}`)}>
              <span className="min-w-0 truncate">
                <span className="font-medium">{c.name}</span>
                <span className="text-text-3">, {c.country}</span>
              </span>
              {busy === c.id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : here.city?.id === c.id ? <Check size={15} className="text-cyan" aria-label="current" /> : <span className="t-micro text-text-3 tnum">{c.n.toLocaleString("en-GB")}</span>}
            </button>
          </li>
        ))}
        {!list.length && cities.length > 0 && <li className="px-2 py-2 t-small text-text-3">No city by that name has events yet.</li>}
      </ul>
      <div className="mt-2 grid gap-1 border-t border-line pt-2">
        <button type="button" className="here-row" onClick={precise} disabled={!!busy}>
          <span className="flex items-center gap-2">
            {busy === "gps" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <LocateFixed size={15} aria-hidden className="text-cyan" />} Use my precise location
          </span>
        </button>
        <button type="button" className="here-row" onClick={() => void apply("any", { any: true }, () => "Showing the whole planet")} disabled={!!busy}>
          <span className="flex items-center gap-2">
            <Globe2 size={15} aria-hidden className="text-text-3" /> Everywhere
          </span>
          {here.source === "any" && <Check size={15} className="text-cyan" aria-label="current" />}
        </button>
      </div>
      <p className="t-micro text-text-3 mt-2">Only the city is kept, on this device. Nothing more precise is stored.</p>
    </div>
  );
  return (
    <div ref={box} className="relative inline-block">
      <button type="button" className={`here-pill here-${tone}`} aria-expanded={open} aria-haspopup="dialog" onPointerEnter={() => void loadCities()} onFocus={() => void loadCities()} onClick={() => setOpen((o) => !o)}>
        <Icon size={14} aria-hidden className="here-pill-icon" />
        {label && <span className="here-pill-label">{label}</span>}
        <span className="truncate max-w-[11rem]">{name}</span>
        <ChevronDown size={14} aria-hidden className="opacity-60" />
      </button>
      {open && (narrow ? createPortal(<><div className="here-scrim" aria-hidden />{sheet}</>, document.body) : sheet)}
    </div>
  );
}
