"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Loader2, MapPin, Plane, Search, Sparkles, Wand2, X } from "lucide-react";
import { CITIES, getDestination } from "@/lib/destinations";
import { GROUPS } from "@/lib/categories";
import { userActions, useUser } from "@/lib/user/store";
import { addDays, bestOrder, flagOf, moveBoundary, nightsBetween, REGIONS, routeKm, splitNights, stopColor, suggestName, withNights, type Place, type TripStop } from "@/lib/trip";
import type { EventCard } from "@/lib/types";
import type { EarthMapHandle, FlyRequest } from "../earth/earth-map";
import { bboxOf, CityPin, dayLabel, longRange, MapIcons, routeOf, shortRange, TripGlobe, TripPass, tripSnapOf, usePanelPad, type MapIcon } from "./shared";
import { toast } from "../toast";

type Stop = Place & { key: string };
const STEPS = ["Where", "When", "Vibe", "Name"] as const;
const EMOJIS = ["✈️", "🌍", "🚆", "🚗", "🎒", "🎉", "🌴", "🏔️", "🎭", "🎶"];
const GROUP_EMOJI: Record<string, string> = {
  music: "🎶", sports: "⚽", theatre: "🎭", comedy: "😂", festivals: "🎉", cinema: "🎬", conferences: "🎤", technology: "💻",
  exhibitions: "🎨", attractions: "🎡", "food-drink": "🍷", nightlife: "🪩", family: "🧸", outdoor: "🥾", education: "📚", fashion: "👗", culture: "🏛️",
};
const LENGTHS = [
  { label: "Long weekend", nights: 3 },
  { label: "A week", nights: 7 },
  { label: "10 days", nights: 10 },
  { label: "Two weeks", nights: 14 },
];
const RADIUS_KM = 30;
let keySeq = 0;
const keyed = (p: Place): Stop => ({ ...p, key: `k${Date.now().toString(36)}${keySeq++}` });
const today = () => new Date().toISOString().slice(0, 10);
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Reorders smoothly where the browser can (each stop keeps its place on screen as it moves). */
const smoothly = (fn: () => void) => {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (d.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) d.startViewTransition(fn);
  else fn();
};

/**
 * Plan a trip: where (any cities, or a ready-made route), when (dates, and the nights in
 * each city on a timeline you drag), what you're into, and a name. The globe answers every
 * choice: cities drop in, the route draws itself, and at the end it flies the whole trip.
 */
export function TripPlanner() {
  const router = useRouter();
  const sp = useSearchParams();
  const user = useUser();
  const api = useRef<EarthMapHandle | null>(null);
  const pad = usePanelPad();
  const [step, setStep] = useState(0);
  const [stops, setStops] = useState<Stop[]>([]);
  const [start, setStart] = useState("");
  const [nights, setNights] = useState<number[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [named, setNamed] = useState(false);
  const [emoji, setEmoji] = useState("✈️");
  const [fly, setFly] = useState<FlyRequest>();
  const [active, setActive] = useState<number | undefined>();
  const [ready, setReady] = useState(false);
  const [tall, setTall] = useState(false);
  /** Created: the pass is stamped, then the trip opens. */
  const [stamped, setStamped] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [withEvent, setWithEvent] = useState<EventCard | null>(null);
  const flyKey = useRef(0);

  const end = start && nights.length ? addDays(start, nights.reduce((a, b) => a + b, 0)) : "";
  const dated: (Stop & { from?: string; to?: string })[] = useMemo(() => (start && nights.length === stops.length ? withNights(stops.map((s) => ({ ...s, from: "", to: "" })), start, nights) : stops), [stops, start, nights]);

  const frame = useCallback(
    (list: { lat: number; lng: number }[]) => {
      const bbox = bboxOf(list);
      if (bbox) setFly({ key: ++flyKey.current, lat: list[0].lat, lng: list[0].lng, bbox, zoom: list.length === 1 ? 7 : 9, padding: pad });
    },
    [pad],
  );

  // Starting points from the address: editing a trip, a city or place, a date, an event, a region.
  useEffect(() => {
    const edit = sp.get("edit");
    const t = edit ? user.trips.find((x) => x.id === edit) : undefined;
    if (t) {
      setEditing(t.id);
      setName(t.name);
      setNamed(true);
      setEmoji(t.emoji ?? "✈️");
      setInterests(t.interests ?? []);
      if (t.stops?.length) {
        setStops(t.stops.map(keyed));
        setStart(t.stops[0].from);
        setNights(t.stops.map((s) => nightsBetween(s.from, s.to)));
      } else if (t.start) {
        setStart(t.start);
      }
      return;
    }
    setInterests(user.prefs.interests.filter((i) => GROUPS.some((g) => g.slug === i)));
    const first: Stop[] = [];
    const city = sp.get("city") ? getDestination(sp.get("city")!) : undefined;
    if (city?.kind === "city") first.push(keyed({ name: city.name, country: city.country, countryCode: city.countryCode, lat: city.lat, lng: city.lng, cityId: city.id }));
    const place = sp.get("place")?.split(",");
    if (place && place.length >= 3 && Number.isFinite(Number(place[0])) && Number.isFinite(Number(place[1])))
      first.push(keyed({ name: decodeURIComponent(place[2]).slice(0, 60), countryCode: place[3]?.slice(0, 2), lat: Number(place[0]), lng: Number(place[1]) }));
    const region = REGIONS.find((r) => r.id === sp.get("region"));
    if (region) region.places.forEach((p) => first.push(keyed(p)));
    if (first.length) setStops(first);
    const date = sp.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      // A trip round an event starts the day before it.
      setStart(addDays(date, -1));
      setNights(first.length ? splitNights(addDays(date, -1), addDays(date, Math.max(2, first.length * 2) - 1), first.length).map((r) => nightsBetween(r.from, r.to)) : []);
    }
    const ev = sp.get("event");
    if (ev)
      fetch(`/api/events/batch?ids=${encodeURIComponent(ev)}`)
        .then((r) => r.json())
        .then((j: { items: EventCard[] }) => setWithEvent(j.items[0] ?? null))
        .catch(() => {});
    // Once, from the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The globe follows the plan: the route redraws with each change, and each city is a pin
  // that pops in when it's added (with its nights, and the kinds of things wanted, as they come).
  const route = useMemo(() => routeOf(stops), [stops]);
  const vibeEmojis = interests.slice(0, 3).map((g) => GROUP_EMOJI[g] ?? "✨");
  const icons = useMemo<MapIcon[]>(
    () =>
      dated.map((s, i) => ({
        key: s.key,
        lat: s.lat,
        lng: s.lng,
        anchor: "bottom",
        node: <CityPin n={i + 1} name={s.name} color={stopColor(i)} active={active === i} note={s.from && s.to ? `${nightsBetween(s.from, s.to)}n` : undefined} emojis={step >= 2 ? vibeEmojis : undefined} onClick={() => setActive((a) => (a === i ? undefined : i))} />,
      })),
    // The emoji list is derived from interests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dated, active, step, interests],
  );
  const framed = useRef("");
  useEffect(() => {
    const sig = stops.map((s) => s.key).join();
    if (sig && sig !== framed.current) {
      framed.current = sig;
      frame(stops);
    }
  }, [stops, frame]);

  // Nights follow the stops: a stop added or removed shares the trip's nights again.
  useEffect(() => {
    if (!start) return;
    setNights((n) => {
      if (n.length === stops.length) return n;
      const total = Math.max(n.reduce((a, b) => a + b, 0), stops.length * 2, 2);
      return splitNights(start, addDays(start, total), stops.length).map((r) => nightsBetween(r.from, r.to));
    });
  }, [stops.length, start]);

  // The name writes itself until it's typed over.
  useEffect(() => {
    if (!named) setName(suggestName(stops, start || undefined));
  }, [stops, start, named]);

  const add = (p: Place) => {
    if (stops.some((s) => Math.abs(s.lat - p.lat) < 0.05 && Math.abs(s.lng - p.lng) < 0.05)) return toast({ title: `${p.name} is already on your route`, emoji: "📍" });
    if (stops.length >= 10) return toast({ title: "Ten cities is the most for one trip", body: "Plan the rest as another trip.", emoji: "🧭" });
    setStops((s) => [...s, keyed(p)]);
  };
  const addRegion = async (r: (typeof REGIONS)[number]) => {
    // One city at a time, so each one lands on the globe.
    for (const p of r.places) {
      add(p);
      await sleep(260);
    }
    if (!named) setEmoji(r.emoji);
  };
  const remove = (key: string) => smoothly(() => setStops((s) => s.filter((x) => x.key !== key)));
  const move = (i: number, d: -1 | 1) =>
    smoothly(() =>
      setStops((s) => {
        const j = i + d;
        if (j < 0 || j >= s.length) return s;
        const out = [...s];
        [out[i], out[j]] = [out[j], out[i]];
        return out;
      }),
    );
  const saved = Math.round(routeKm(stops) - routeKm(bestOrder(stops)));
  const reorder = () => {
    smoothly(() => setStops((s) => bestOrder(s)));
    toast({ title: "Shortest route", body: `${saved.toLocaleString("en-GB")} km less on the way`, emoji: "🪄" });
  };

  const setLength = (n: number) => {
    const s = start || addDays(today(), 21);
    setStart(s);
    setNights(splitNights(s, addDays(s, Math.max(n, stops.length)), stops.length).map((r) => nightsBetween(r.from, r.to)));
  };
  const setEnd = (e: string) => {
    if (!start || !e || e <= start) return;
    setNights(splitNights(start, e, stops.length).map((r) => nightsBetween(r.from, r.to)));
  };
  const goWhen = () => {
    if (!start) setLength(Math.min(14, Math.max(3, stops.length * 2)));
    setStep(1);
  };

  const canNext = step === 0 ? stops.length > 0 : step === 1 ? !!start && !!end && nights.every((n) => n >= 0) : step === 3 ? !!name.trim() : true;
  const next = () => (step === 0 ? goWhen() : setStep((s) => Math.min(3, s + 1)));

  const create = async () => {
    const tripStops: TripStop[] = withNights(stops.map(({ key, ...p }) => ({ ...p, id: key, from: "", to: "" })), start, nights);
    let id = editing;
    if (id) userActions.updateTrip(id, { name: name.trim(), emoji, interests, stops: tripStops, start, end });
    else {
      // The event the trip was planned around comes with it.
      const first = withEvent ? tripSnapOf(withEvent) : null;
      const snaps = first ? { [first.id]: { ...first, id: undefined } } : undefined;
      id = userActions.createTrip(name.trim(), start, end, withEvent ? [withEvent.id] : [], { stops: tripStops, emoji, interests, snaps });
    }
    // The pass gets its stamp, then the trip opens.
    setStamped(true);
    try {
      navigator.vibrate?.([10, 50, 16]);
    } catch {
      // no vibration here
    }
    await sleep(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 1100);
    router.push(`/trips/${id}?hello=1`);
  };

  return (
    <div className="trip-stage">
      <TripGlobe api={api} route={route} fly={fly} pad={pad} onReady={() => setReady(true)} onBackground={() => setActive(undefined)} label="Globe showing the trip you're planning: its cities and the route between them." />
      <MapIcons api={api} ready={ready} icons={icons} />
      <section className="planner-panel" aria-label="Plan a trip" data-tall={tall || undefined}>
        <button type="button" className="sheet-grab" aria-label={tall ? "Show more of the globe" : "Show more of the planner"} aria-expanded={tall} onClick={() => setTall((t) => !t)}><span aria-hidden /></button>
        <header className="planner-head">
          <div className="flex items-center justify-between gap-3">
            <h1 className="t-h2 font-display-tight">{editing ? "Edit your trip" : "Plan a trip"}</h1>
            <Link href="/trips" className="btn btn-ghost btn-icon btn-sm" aria-label="Close the planner">
              <X size={18} aria-hidden />
            </Link>
          </div>
          <ol className="planner-steps" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button type="button" className="planner-step" aria-current={i === step ? "step" : undefined} data-done={i < step || undefined} disabled={i > step && !(i === 1 && stops.length) && !(i > 1 && end)} onClick={() => (i === 1 && step === 0 ? goWhen() : setStep(i))}>
                  <span className="planner-step-n">{i < step ? <Check size={12} aria-hidden /> : i + 1}</span> {s}
                </button>
              </li>
            ))}
          </ol>
        </header>

        <div className="planner-body" key={step}>
          {step === 0 && (
            <>
              <p className="planner-q">Where are you going?</p>
              <PlaceSearch onPick={add} />
              <div className="mt-4">
                <p className="t-small text-text-2 mb-2">Or start from a route</p>
                <div className="flex flex-wrap gap-1.5">
                  {REGIONS.map((r) => (
                    <button key={r.id} type="button" className="chip press" onClick={() => void addRegion(r)}>
                      <span aria-hidden>{r.emoji}</span> {r.name}
                    </button>
                  ))}
                </div>
              </div>
              {stops.length > 0 && (
                <div className="mt-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="t-small font-semibold">Your route, in order</p>
                    {stops.length > 2 && saved > 20 && (
                      <button type="button" className="btn btn-ghost btn-sm text-cyan" onClick={reorder}>
                        <Wand2 size={14} aria-hidden /> Shortest order
                      </button>
                    )}
                  </div>
                  <ol className="planner-stops">
                    {stops.map((s, i) => (
                      <li key={s.key} className="planner-stop" style={{ viewTransitionName: `stop-${s.key}`, "--ink": stopColor(i) } as React.CSSProperties} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(undefined)}>
                        <span className="planner-stop-n" aria-hidden>{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold truncate">{s.name}</span>
                          <span className="block t-micro text-text-3 truncate">{[flagOf(s.countryCode), s.country].filter(Boolean).join(" ")}</span>
                        </span>
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${s.name} earlier`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={15} aria-hidden /></button>
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${s.name} later`} disabled={i === stops.length - 1} onClick={() => move(i, 1)}><ArrowDown size={15} aria-hidden /></button>
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${s.name}`} onClick={() => remove(s.key)}><X size={15} aria-hidden /></button>
                      </li>
                    ))}
                  </ol>
                  {stops.length > 1 && <p className="t-micro text-text-3 mt-2 tnum">{Math.round(routeKm(stops)).toLocaleString("en-GB")} km from first to last city</p>}
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <p className="planner-q">When are you going?</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="label">Arriving</span>
                  <input type="date" className="field" min={today()} value={start} onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setStart(v);
                    setNights((n) => (n.length === stops.length ? n : splitNights(v, addDays(v, stops.length * 2), stops.length).map((r) => nightsBetween(r.from, r.to))));
                  }} />
                </label>
                <label className="block">
                  <span className="label">Leaving</span>
                  <input type="date" className="field" min={start ? addDays(start, Math.max(1, stops.length)) : today()} value={end} onChange={(e) => setEnd(e.target.value)} />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {LENGTHS.map((l) => (
                  <button key={l.label} type="button" className="chip press" data-active={nights.reduce((a, b) => a + b, 0) === l.nights || undefined} onClick={() => setLength(l.nights)}>{l.label}</button>
                ))}
              </div>
              {start && end && stops.length > 0 && (
                <NightsBar stops={dated as (Stop & { from: string; to: string })[]} nights={nights} onChange={setNights} interests={interests} onFocusStop={setActive} onPick={(i) => frame([stops[i]])} />
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p className="planner-q">What are you into?</p>
              <p className="t-small text-text-2 -mt-1 mb-3">Suggestions on your trip follow these. Pick none for a bit of everything.</p>
              <div className="flex flex-wrap gap-1.5">
                {GROUPS.filter((g) => g.slug !== "other").map((g) => {
                  const on = interests.includes(g.slug);
                  return (
                    <button key={g.slug} type="button" className="chip press vibe-chip" aria-pressed={on} onClick={() => setInterests((x) => (on ? x.filter((y) => y !== g.slug) : [...x, g.slug]))}>
                      <span aria-hidden>{GROUP_EMOJI[g.slug] ?? "✨"}</span> {g.name.split(" &")[0]}
                    </button>
                  );
                })}
              </div>
              <StopCounts stops={dated as (Stop & { from: string; to: string })[]} interests={interests} />
            </>
          )}

          {step === 3 && (
            <>
              <p className="planner-q">Name your trip</p>
              <input className="field planner-name" value={name} maxLength={60} onChange={(e) => (setName(e.target.value), setNamed(true))} aria-label="Trip name" />
              <div className="mt-3 flex flex-wrap gap-1" role="radiogroup" aria-label="Trip emoji">
                {EMOJIS.map((e) => (
                  <button key={e} type="button" role="radio" aria-checked={emoji === e} className="emoji-pick press" onClick={() => setEmoji(e)}>{e}</button>
                ))}
              </div>
              <div className="mt-5 relative">
                <TripPass name={name || "My trip"} emoji={emoji} stops={stops} start={start} end={end} events={withEvent ? 1 : 0} />
                {stamped && <span className="pass-stamp" aria-hidden>Let&apos;s go!</span>}
              </div>
              {stamped && <p className="sr-only" role="status">Trip saved. Opening it…</p>}
              {withEvent && <p className="t-small text-text-2 mt-3"><Sparkles size={14} className="inline text-sun" aria-hidden /> {withEvent.title} comes with it.</p>}
            </>
          )}
        </div>

        <footer className="planner-foot">
          {step > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}><ArrowLeft size={16} aria-hidden /> Back</button>
          ) : <span />}
          {step < 3 ? (
            <button type="button" className="btn btn-primary press" disabled={!canNext} onClick={next}>
              {step === 0 ? (stops.length ? `Next: when` : "Add a city") : step === 1 ? "Next: what you like" : "Next: name it"} <ArrowRight size={16} aria-hidden />
            </button>
          ) : (
            <button type="button" className="btn btn-primary press" disabled={!canNext || stamped} onClick={() => void create()}>
              <Plane size={16} aria-hidden /> {editing ? "Save trip" : "Create trip"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

/** Any city on Earth: the site's own cities at once, the rest from the place search. */
function PlaceSearch({ onPick }: { onPick: (p: Place) => void }) {
  const [q, setQ] = useState("");
  const [far, setFar] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const near = useMemo(() => {
    const t = plain(q.trim());
    if (t.length < 1) return [];
    return CITIES.filter((c) => plain(c.name).startsWith(t) || c.aliases?.some((a) => plain(a).startsWith(t)))
      .slice(0, 5)
      .map((c): Place => ({ name: c.name, country: c.country, countryCode: c.countryCode, lat: c.lat, lng: c.lng, cityId: c.id }));
  }, [q]);
  useEffect(() => {
    const t = q.trim();
    setFar([]);
    if (t.length < 3) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true);
      fetch(`/api/geocode?q=${encodeURIComponent(t)}&limit=8&lang=en`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((j: { results: { name: string; context?: string; kind: string; lat: number; lng: number; countryCode?: string }[] }) =>
          setFar(
            j.results
              .filter((r) => ["city", "town", "village", "locality", "municipality", "place"].includes(r.kind))
              .map((r): Place => ({ name: r.name, country: r.context?.split(",").pop()?.trim() || undefined, countryCode: r.countryCode, lat: r.lat, lng: r.lng })),
          ),
        )
        .catch(() => {})
        .finally(() => setBusy(false));
    }, 300);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);
  const list = [...near, ...far.filter((f) => !near.some((n) => Math.abs(n.lat - f.lat) < 0.2 && Math.abs(n.lng - f.lng) < 0.2))].slice(0, 7);
  const pick = (p: Place) => {
    onPick(p);
    setQ("");
    setHi(0);
    input.current?.focus();
  };
  return (
    <div className="relative">
      <label className="sr-only" htmlFor="trip-place">Add a city</label>
      <div className="planner-search">
        <Search size={17} aria-hidden className="text-text-3" />
        <input
          ref={input}
          id="trip-place"
          className="flex-1 bg-transparent outline-none min-w-0"
          placeholder="Add a city: Amsterdam, Kyoto, Marrakech…"
          autoComplete="off"
          role="combobox"
          aria-expanded={list.length > 0}
          aria-controls="trip-place-list"
          aria-activedescendant={list[hi] ? `trip-place-${hi}` : undefined}
          value={q}
          onChange={(e) => (setQ(e.target.value), setHi(0))}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(list.length - 1, h + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(0, h - 1));
            } else if (e.key === "Enter" && list[hi]) {
              e.preventDefault();
              pick(list[hi]);
            } else if (e.key === "Escape") setQ("");
          }}
        />
        {busy && <Loader2 size={15} className="animate-spin text-text-3" aria-hidden />}
      </div>
      {list.length > 0 && (
        <ul id="trip-place-list" role="listbox" className="planner-results">
          {list.map((p, i) => (
            <li key={`${p.name}-${p.lat}`} id={`trip-place-${i}`} role="option" aria-selected={i === hi}>
              <button type="button" className="planner-result" data-hi={i === hi || undefined} onMouseEnter={() => setHi(i)} onClick={() => pick(p)}>
                <span className="text-lg" aria-hidden>{flagOf(p.countryCode) || <MapPin size={16} />}</span>
                <span className="min-w-0">
                  <span className="block font-semibold truncate">{p.name}</span>
                  {p.country && <span className="block t-micro text-text-3 truncate">{p.country}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How many events each city has on its dates, for the vibe chosen. */
function useCounts(stops: (Place & { key: string; from: string; to: string })[], interests: string[]) {
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const sig = stops.map((s) => `${s.key}:${s.from}:${s.to}`).join("|") + `|${interests.join(",")}`;
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      for (const s of stops) {
        if (!s.from || !s.to) continue;
        const p = new URLSearchParams({ lat: s.lat.toFixed(4), lng: s.lng.toFixed(4), radius: String(RADIUS_KM), from: s.from, to: s.to, size: "1" });
        if (interests.length) p.set("cat", interests.join(","));
        setCounts((c) => ({ ...c, [s.key]: c[s.key] ?? null }));
        fetch(`/api/events?${p}`, { signal: ctrl.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((j: { total?: number } | null) => setCounts((c) => ({ ...c, [s.key]: j?.total ?? 0 })))
          .catch(() => {});
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
    // The signature covers the stops, their dates and the vibe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return counts;
}

/**
 * The trip as one bar, a coloured stretch per city as long as its nights. Drag the line
 * between two cities (or focus it and use the arrow keys) to move a night from one to the
 * other; each stretch says how many events are on there on those days.
 */
function NightsBar({ stops, nights, onChange, interests, onFocusStop, onPick }: { stops: (Stop & { from: string; to: string })[]; nights: number[]; onChange: (n: number[]) => void; interests: string[]; onFocusStop: (i?: number) => void; onPick: (i: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; x: number; base: number[] } | null>(null);
  const total = Math.max(1, nights.reduce((a, b) => a + b, 0));
  const counts = useCounts(stops, interests);
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const w = bar.current?.clientWidth ?? 1;
    if (!d) return;
    const delta = Math.round(((e.clientX - d.x) / w) * total);
    onChange(moveBoundary(d.base, d.i, delta));
  };
  return (
    <div className="mt-5">
      <div ref={bar} className="nights-bar" onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
        {stops.map((s, i) => (
          <div key={s.key} className="nights-seg" style={{ flexGrow: Math.max(0.35, nights[i] ?? 0), "--ink": stopColor(i) } as React.CSSProperties} onMouseEnter={() => onFocusStop(i)} onMouseLeave={() => onFocusStop(undefined)}>
            <button type="button" className="nights-seg-body" onClick={() => onPick(i)} aria-label={`${s.name}: ${nights[i]} ${nights[i] === 1 ? "night" : "nights"}, ${shortRange(s.from, s.to)}. Show on the globe.`}>
              <span className="nights-seg-name">{s.name}</span>
              <span className="nights-seg-n tnum">{nights[i]}<span className="sr-only"> nights</span><span aria-hidden>n</span></span>
            </button>
            {i < stops.length - 1 && (
              <button
                type="button"
                className="nights-handle"
                aria-label={`Move a night between ${s.name} and ${stops[i + 1].name}. Left arrow gives ${stops[i + 1].name} a night, right arrow gives ${s.name} one.`}
                onPointerDown={(e) => {
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  drag.current = { i, x: e.clientX, base: nights };
                }}
                onPointerMove={onMove}
                onPointerUp={() => (drag.current = null)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  e.preventDefault();
                  onChange(moveBoundary(nights, i, e.key === "ArrowRight" ? 1 : -1));
                }}
              >
                <span aria-hidden />
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="t-micro text-text-3 mt-1.5">Drag the white lines to move nights between cities.</p>
      <ul className="mt-3 grid gap-1.5">
        {stops.map((s, i) => (
          <li key={s.key} className="nights-row" style={{ "--ink": stopColor(i) } as React.CSSProperties}>
            <span className="planner-stop-n" aria-hidden>{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{s.name}</span>
              <span className="t-small text-text-2"> {dayLabel(s.from)} → {dayLabel(s.to)}</span>
            </span>
            <span className="t-small tnum text-text-2 shrink-0">{counts[s.key] == null ? <Loader2 size={13} className="animate-spin inline" aria-label="Counting events" /> : `${counts[s.key]!.toLocaleString("en-GB")} on`}</span>
          </li>
        ))}
      </ul>
      {stops.length > 1 && nights.some((n) => n === 0) && <p className="t-small text-warn mt-2">A city with no nights is a day trip: you pass through on a travel day.</p>}
    </div>
  );
}

/** The events waiting in each city, for the vibe chosen. */
function StopCounts({ stops, interests }: { stops: (Stop & { from: string; to: string })[]; interests: string[] }) {
  const counts = useCounts(stops, interests);
  const known = stops.filter((s) => typeof counts[s.key] === "number");
  const sum = known.reduce((n, s) => n + (counts[s.key] ?? 0), 0);
  if (!stops.length || !stops[0].from) return null;
  return (
    <p className="mt-5 t-small text-text-2" aria-live="polite">
      {known.length < stops.length ? (
        <><Loader2 size={13} className="animate-spin inline mr-1" aria-hidden />Looking at what&apos;s on…</>
      ) : (
        <><b className="text-text tnum">{sum.toLocaleString("en-GB")}</b> events on your route on your dates{interests.length ? " for what you like" : ""}: {longRange(stops[0].from, stops[stops.length - 1].to)}.</>
      )}
    </p>
  );
}
