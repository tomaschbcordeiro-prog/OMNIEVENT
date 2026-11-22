"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Dices, MapPin, Search, X } from "lucide-react";
import { AREAS, countryName, findCountries, findPlaces, ideasPage, LENGTHS, planHref, THEME_HUE, THEMES, type Area, type IdeaFilter, type Length, type ThemeKey, type TripIdea } from "@/lib/travel/ideas";
import { flagOf } from "@/lib/trip";
import { RouteSketch } from "./route-sketch";
import { SharedTripsRail } from "./shared-trips";
import { Glyph, isFlag } from "../glyph";

/*
 * Trip ideas without end: routes round a theme, a region, a length or a place, in pages that
 * keep coming as you scroll. Each opens the planner with its stops and nights filled in.
 */

const PAGE = 12;
const HUE = THEME_HUE;

type Where = { kind: "near"; label: string; lat: number; lng: number } | { kind: "in"; label: string; cc: string };


function readFilter(): { f: IdeaFilter; where: Where | null } {
  if (typeof window === "undefined") return { f: {}, where: null };
  const q = new URLSearchParams(window.location.search);
  const f: IdeaFilter = {};
  const theme = q.get("theme");
  if (theme && THEMES.some((t) => t.key === theme)) f.theme = theme as ThemeKey;
  const area = q.get("area");
  if (area && AREAS.some((a) => a.key === area)) f.area = area as Area;
  const length = q.get("length");
  if (length && LENGTHS.some((l) => l.key === length)) f.length = length as Length;
  let where: Where | null = null;
  const cc = q.get("in");
  if (cc && /^[A-Z]{2}$/.test(cc)) where = { kind: "in", label: countryName(cc), cc };
  const near = q.get("near")?.split(",");
  if (near && near.length >= 3 && Number.isFinite(+near[0]) && Number.isFinite(+near[1])) where = { kind: "near", lat: +near[0], lng: +near[1], label: near.slice(2).join(",").slice(0, 60) };
  return { f, where };
}

/** `seed`: today's, from the server, so the page it sends and the browser's match; shuffling changes it. */
export function TripIdeasFeed({ seed: daily }: { seed: string }) {
  const [f, setF] = useState<IdeaFilter>({});
  const [where, setWhere] = useState<Where | null>(null);
  const [seed, setSeed] = useState(daily);
  // Filters from the address, once in the browser.
  useEffect(() => {
    const r = readFilter();
    setF(r.f);
    setWhere(r.where);
  }, []);
  const filter: IdeaFilter = useMemo(() => ({ ...f, ...(where?.kind === "in" ? { cc: where.cc } : where?.kind === "near" ? { near: { lat: where.lat, lng: where.lng } } : {}) }), [f, where]);
  // Keep the choice in the address, to share it or come back to it.
  useEffect(() => {
    const q = new URLSearchParams();
    if (f.theme) q.set("theme", f.theme);
    if (f.area) q.set("area", f.area);
    if (f.length) q.set("length", f.length);
    if (where?.kind === "in") q.set("in", where.cc);
    if (where?.kind === "near") q.set("near", `${where.lat.toFixed(3)},${where.lng.toFixed(3)},${where.label}`);
    const s = q.toString();
    window.history.replaceState(window.history.state, "", s ? `?${s}` : window.location.pathname);
  }, [f, where]);

  const [ideas, setIdeas] = useState<TripIdea[]>(() => ideasPage(daily, 0, PAGE).ideas);
  const [next, setNext] = useState(0);
  const [done, setDone] = useState(false);
  const seen = useRef(new Set<string>());
  const key = JSON.stringify([filter, seed]);
  const first = useRef(true);
  // A new choice starts the list again.
  useEffect(() => {
    if (first.current && !Object.keys(filter).length && seed === daily) {
      first.current = false;
      const page = ideasPage(seed, 0, PAGE, filter);
      seen.current = new Set(page.ideas.map((i) => i.key));
      setNext(page.next);
      return;
    }
    first.current = false;
    seen.current = new Set();
    const page = ideasPage(seed, 0, PAGE, filter, seen.current);
    page.ideas.forEach((i) => seen.current.add(i.key));
    setIdeas(page.ideas);
    setNext(page.next);
    setDone(page.ideas.length < PAGE);
    // `key` says when filter or seed changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const more = useCallback(() => {
    if (done) return;
    const page = ideasPage(seed, next, PAGE, filter, seen.current);
    page.ideas.forEach((i) => seen.current.add(i.key));
    setIdeas((list) => [...list, ...page.ideas]);
    setNext(page.next);
    if (page.ideas.length < PAGE) setDone(true);
  }, [done, seed, next, filter]);

  // More as the end of the list comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && more(), { rootMargin: "900px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, done]);

  const set = (patch: Partial<IdeaFilter>) => setF((x) => ({ ...x, ...patch }));
  const shuffle = () => {
    setSeed(Math.random().toString(36).slice(2, 10));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const likeThis = (i: TripIdea) => {
    setF({ theme: i.theme, length: f.length });
    setWhere(i.countries.length === 1 ? { kind: "in", cc: i.countries[0], label: countryName(i.countries[0]) } : { kind: "near", lat: i.stops[0].place.lat, lng: i.stops[0].place.lng, label: i.stops[0].place.name });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="mx-auto max-w-[1200px] px-4 sm:px-6 pt-8 pb-16">
      <nav aria-label="Breadcrumb" className="t-small font-semibold text-text-2"><Link href="/trips" className="hover:underline">Trips</Link> / Ideas</nav>
      <div className="flex items-end justify-between gap-3 mt-1">
        <h1 className="t-display">Trip ideas</h1>
        <button type="button" className="btn btn-primary press ideas-shuffle shrink-0" onClick={shuffle}><Dices size={16} aria-hidden /> Shuffle</button>
      </div>
      <p className="t-lede text-text-2 mt-2 measure max-sm:text-base">Routes round the world that never run out. Pick one, change anything, make it yours.</p>

      <div className="ideas-controls">
        <WherePicker where={where} onPick={setWhere} />
        <div className="ideas-chips" role="group" aria-label="Theme">
          <button type="button" className="chip press" data-active={!f.theme || undefined} aria-pressed={!f.theme} onClick={() => set({ theme: undefined })}>Anything</button>
          {THEMES.map((t) => (
            <button key={t.key} type="button" className="chip press" data-active={f.theme === t.key || undefined} aria-pressed={f.theme === t.key} onClick={() => set({ theme: f.theme === t.key ? undefined : t.key })}>
              <Glyph e={t.emoji} /> {t.label}
            </button>
          ))}
        </div>
        <div className="ideas-chips" role="group" aria-label="Where and how long">
          {AREAS.map((a) => (
            <button key={a.key} type="button" className="chip press" data-active={f.area === a.key || undefined} aria-pressed={f.area === a.key} onClick={() => set({ area: f.area === a.key ? undefined : a.key })}>
              {a.label}
            </button>
          ))}
          <span className="ideas-sep" aria-hidden />
          {LENGTHS.map((l) => (
            <button key={l.key} type="button" className="chip press" data-active={f.length === l.key || undefined} aria-pressed={f.length === l.key} onClick={() => set({ length: f.length === l.key ? undefined : l.key })}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <h2 className="sr-only">Ideas</h2>
      {ideas.length === 0 ? (
        <div className="trips-empty mt-8">
          <p className="t-h2">Nothing for that mix</p>
          <p className="t-body text-text-2 mt-1">Try another theme or place, or clear the filters.</p>
          <button type="button" className="btn btn-secondary mt-4 press" onClick={() => (setF({}), setWhere(null))}>Clear the filters</button>
        </div>
      ) : (
        <>
          <ul className="ideas-grid">
            {ideas.slice(0, 6).map((i, n) => <IdeaCard key={i.key} idea={i} n={n} onLikeThis={() => likeThis(i)} />)}
          </ul>
          {/* Trips people shared, after the first few ideas. */}
          <SharedTripsRail />
          {ideas.length > 6 && (
            <ul className="ideas-grid">
              {ideas.slice(6).map((i, n) => <IdeaCard key={i.key} idea={i} n={(n + 6) % PAGE} onLikeThis={() => likeThis(i)} />)}
            </ul>
          )}
        </>
      )}
      <div ref={sentinel} aria-hidden className="h-px" />
      {done && ideas.length > 0 ? (
        <p className="t-small text-text-2 text-center mt-8">That&apos;s every idea for this mix. <button type="button" className="underline font-semibold" onClick={() => (setF({}), setWhere(null))}>See them all</button></p>
      ) : (
        ideas.length > 0 && (
          <p className="text-center mt-8">
            <button type="button" className="btn btn-secondary press" onClick={more}>More ideas</button>
          </p>
        )
      )}
      <p className="t-micro text-text-3 mt-10">Places from GeoNames (geonames.org, CC BY 4.0). Ideas are suggestions: check travel times and borders before you book.</p>
    </main>
  );
}

function IdeaCard({ idea: i, n, onLikeThis }: { idea: TripIdea; n: number; onLikeThis: () => void }) {
  const flags = i.countries.map(flagOf).join(" ");
  return (
    <li className="idea-card" style={{ "--h": HUE[i.theme], "--i": n } as React.CSSProperties}>
      <Link href={planHref(i)} className="idea-top" aria-label={`Plan this trip: ${i.title}`}>
        <RouteSketch stops={i.stops.map((s) => s.place)} />
        <span className="idea-theme"><Glyph e={THEMES.find((t) => t.key === i.theme)?.emoji} size={13} /> {THEMES.find((t) => t.key === i.theme)?.label}</span>
      </Link>
      <div className="idea-body">
        <h3 className="idea-title">{isFlag(i.emoji) && <span aria-hidden>{i.emoji}</span>} {i.title}</h3>
        <p className="idea-route">
          {i.stops.map((s, k) => (
            <span key={s.place.n}>
              {k > 0 && <span className="text-text-3" aria-hidden> → </span>}
              {s.place.name} <span className="text-text-3 tnum">{s.nights}n</span>
            </span>
          ))}
        </p>
        <p className="t-micro text-text-2 mt-2 tnum">
          {i.nights} {i.nights === 1 ? "night" : "nights"}
          {i.stops.length > 1 && <> · {i.km.toLocaleString("en-GB")} km</>} · <span aria-hidden>{flags}</span>
          <span className="sr-only">{i.countries.map(countryName).join(", ")}</span>
        </p>
        <p className="t-small text-text-2 mt-1">{i.about}</p>
        <div className="idea-actions">
          <Link href={planHref(i)} className="btn btn-primary btn-sm press">Plan this trip <ArrowRight size={14} aria-hidden /></Link>
          <button type="button" className="btn btn-ghost btn-sm press" onClick={onLikeThis}>More like this</button>
        </div>
      </div>
    </li>
  );
}

/** "Ideas around…": a place or a country, typed. */
function WherePicker({ where, onPick }: { where: Where | null; onPick: (w: Where | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const options: Where[] = useMemo(
    () => [
      ...findCountries(q, 3).map((c): Where => ({ kind: "in", cc: c.cc, label: c.name })),
      ...findPlaces(q, 6).map((p): Where => ({ kind: "near", lat: p.lat, lng: p.lng, label: p.name })),
    ],
    [q],
  );
  const choose = (w: Where) => {
    onPick(w);
    setQ("");
    setOpen(false);
  };
  if (where)
    return (
      <p className="ideas-where">
        <MapPin size={15} aria-hidden />
        <span>{where.kind === "in" ? <>In <b>{where.label}</b></> : <>Near <b>{where.label}</b></>}</span>
        <button type="button" className="ideas-where-x press" onClick={() => onPick(null)} aria-label="Anywhere in the world"><X size={14} /></button>
      </p>
    );
  return (
    <div className="ideas-search">
      <Search size={16} aria-hidden className="ideas-search-icon" />
      <input
        className="field"
        type="search"
        placeholder="Ideas around a city or a country"
        aria-label="Ideas around a city or a country"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls="ideas-where-list"
        aria-autocomplete="list"
        value={q}
        onChange={(e) => (setQ(e.target.value), setOpen(true), setAt(0))}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAt((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAt((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && options[at]) {
            e.preventDefault();
            choose(options[at]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && options.length > 0 && (
        <ul id="ideas-where-list" role="listbox" className="ideas-options" aria-label="Places and countries">
          {options.map((o, k) => (
            <li key={`${o.kind}${o.label}${k}`} role="option" aria-selected={k === at} data-active={k === at || undefined} onMouseDown={(e) => (e.preventDefault(), choose(o))} onMouseMove={() => setAt(k)}>
              {o.kind === "in" ? <>{flagOf(o.cc)} All of <b>{o.label}</b></> : <><MapPin size={13} aria-hidden /> Around <b>{o.label}</b></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
