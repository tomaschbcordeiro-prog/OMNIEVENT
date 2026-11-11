"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Hand, Loader2, Plane, Sparkles, Wand2, X } from "lucide-react";
import { getDestination } from "@/lib/destinations";
import { GROUPS } from "@/lib/categories";
import { userActions, useUser } from "@/lib/user/store";
import { addDays, bestOrder, bestSlot, midpoint, routeFromEvents, moveBoundary, moved, nightsBetween, nightsWithout, nightsWithStop, REGIONS, relocated, renamed, routeKm, splitNights, stopColor, suggestName, withNights, type Place, type TripStop } from "@/lib/trip";
import type { Town } from "@/lib/town";
import type { EventCard } from "@/lib/types";
import type { EarthMapHandle, FlyRequest, MapClick } from "../earth/earth-map";
import { bboxOf, CityPin, dayLabel, longRange, MapIcons, routeOf, SheetGrab, shortRange, TripGlobe, TripPass, tripSnapOf, usePanelPad, useSheet, type MapIcon } from "./shared";
import { localDateKey } from "@/lib/format";
import { toast } from "../toast";
import { LegPlus, lookupTown, MapAddCard, PlaceSearch, placeOfTown, RouteList, type RouteStop } from "./route-edit";

type Stop = RouteStop;
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
const MAX_STOPS = 10;
/** Map labels that name a town (tapping one adds it by that name). */
const SETTLEMENTS = new Set(["city", "town", "village", "hamlet", "suburb", "locality"]);
let keySeq = 0;
const keyed = (p: Place): Stop => ({ ...p, key: `k${Date.now().toString(36)}${keySeq++}` });
const today = () => new Date().toISOString().slice(0, 10);
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
  const sheet = useSheet("half");
  const pad = usePanelPad(sheet.panel);
  const [step, setStepState] = useState(0);
  /** A new step gets the sheet back to half (a phone shows the step and the globe). */
  const setStep = (v: number | ((s: number) => number)) => {
    setStepState(v);
    sheet.setSnap("half");
  };
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
  /** Created: the pass is stamped, then the trip opens. */
  const [stamped, setStamped] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  /** Events the trip is planned around: they come with it. */
  const [withEvents, setWithEvents] = useState<EventCard[]>([]);
  /** The gap in the route list a stop is being typed into (the index it will take). */
  const [inserting, setInserting] = useState<number | null>(null);
  /** The leg whose "+" on the globe is open to type a place. */
  const [legOpen, setLegOpen] = useState<number | null>(null);
  /** Its card opens below the "+" when the "+" is near the top of the screen. */
  const [legBelow, setLegBelow] = useState(false);
  /** A leg's "+" being dragged across the map: where it is now. */
  const [legDrag, setLegDrag] = useState<{ i: number; lat: number; lng: number } | null>(null);
  /** A place tapped on the map, waiting to be added. */
  const [tap, setTap] = useState<{ lat: number; lng: number; label?: string; town?: Town; below?: boolean } | null>(null);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    try {
      setHint(!localStorage.getItem("omnievent:hint:route"));
    } catch {
      setHint(true);
    }
  }, []);
  const flyKey = useRef(0);
  const stopsNow = useRef(stops);
  stopsNow.current = stops;
  /** The next change to the route was made on the globe (so the camera stays put). */
  const onMap = useRef(false);

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
        let list = t.stops.map(keyed);
        let n = t.stops.map((s) => nightsBetween(s.from, s.to));
        // A place sent from elsewhere on the site ("Add to this trip"): where it fits best.
        const extra = sp.get("add")?.split(",");
        if (extra && extra.length >= 3 && Number.isFinite(Number(extra[0])) && Number.isFinite(Number(extra[1]))) {
          const p: Place = { name: decodeURIComponent(extra[2]).slice(0, 60), countryCode: extra[3]?.slice(0, 2) || undefined, lat: Number(extra[0]), lng: Number(extra[1]), cityId: extra[4] || undefined };
          const at = bestSlot(list, p);
          list = [...list.slice(0, at), keyed(p), ...list.slice(at)];
          n = nightsWithStop(n, at);
          toast({ title: `${p.name} added to the route`, body: "Move it or change the nights, then save.", emoji: "📍" });
        }
        setStops(list);
        setStart(t.stops[0].from);
        setNights(n);
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
    // Events to plan around: one (an event's "Plan a trip around this") or several (a trip idea
    // from saved events, whose cities and dates then make the route).
    const ids = [...new Set([sp.get("event"), ...(sp.get("events")?.split(",") ?? [])].filter((x): x is string => !!x))].slice(0, 20);
    if (ids.length)
      fetch(`/api/events/batch?ids=${encodeURIComponent(ids.join(","))}`)
        .then((r) => r.json())
        .then((j: { items: EventCard[] }) => {
          setWithEvents(j.items);
          if (first.length || !sp.get("events") || !j.items.length) return;
          const r = routeFromEvents(
            j.items.map((c) => {
              const city = c.cityId ? getDestination(c.cityId) : undefined;
              return { day: localDateKey(c.start, c.timeZone), place: city ? { name: city.name, country: city.country, countryCode: city.countryCode, lat: city.lat, lng: city.lng, cityId: city.id } : { name: c.city, country: c.country, lat: c.lat, lng: c.lng } };
            }),
          );
          if (!r) return;
          setStops(r.places.slice(0, MAX_STOPS).map(keyed));
          setStart(r.start);
          setNights(r.nights.slice(0, MAX_STOPS));
        })
        .catch(() => {});
    // Once, from the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The globe follows the plan: the route redraws with each change (and bends live through a
  // "+" being dragged), and each city is a pin that pops in when it's added and can be dragged
  // somewhere else; in the middle of each leg, a "+" adds a stop on the way.
  const route = useMemo(() => routeOf(legDrag ? [...stops.slice(0, legDrag.i + 1), legDrag, ...stops.slice(legDrag.i + 1)] : stops), [stops, legDrag]);
  const vibeEmojis = interests.slice(0, 3).map((g) => GROUP_EMOJI[g] ?? "✨");
  const icons = useMemo<MapIcon[]>(() => {
    const out: MapIcon[] = dated.map((s, i) => ({
      key: s.key,
      lat: s.lat,
      lng: s.lng,
      anchor: "bottom",
      node: <CityPin n={i + 1} name={s.name} color={stopColor(i)} active={active === i} looking={s.looking} hint="Drag to move it" note={s.from && s.to ? `${nightsBetween(s.from, s.to)}n` : undefined} emojis={step >= 2 ? vibeEmojis : undefined} onClick={() => setActive((a) => (a === i ? undefined : i))} />,
      drag: { onStart: () => (setActive(i), setTap(null), sheet.setSnap("peek")), onMove: (lat, lng) => follow(s.key, lat, lng), onEnd: (lat, lng) => void settle(s.key, lat, lng) },
    }));
    if (step === 0)
      stops.slice(1).forEach((b, j) => {
        const a = stops[j];
        const m = midpoint(a, b);
        out.push({
          key: `leg:${a.key}:${b.key}`,
          lat: m.lat,
          lng: m.lng,
          delay: 200,
          node: <LegPlus from={a.name} to={b.name} open={legOpen === j} below={legBelow} onOpen={() => openLeg(j)} onClose={() => setLegOpen(null)} onPick={(p) => ((onMap.current = true), insertAt(j + 1, p), setLegOpen(null))} />,
          // While it's open to type in, it stays put.
          drag: legOpen === j ? undefined : { onStart: () => (setLegOpen(null), setTap(null), sheet.setSnap("peek")), onMove: (lat, lng) => setLegDrag({ i: j, lat, lng }), onEnd: (lat, lng) => void dropOnLeg(j, lat, lng) },
        });
      });
    if (tap && step === 0) {
      const slot = bestSlot(stops, tap);
      const where = !stops.length ? "" : slot === 0 ? `Before ${stops[0].name}` : slot >= stops.length ? `After ${stops[stops.length - 1].name}` : `Between ${stops[slot - 1].name} and ${stops[slot].name}`;
      out.push({ key: `tap:${tap.lat}:${tap.lng}`, lat: tap.lat, lng: tap.lng, anchor: tap.below ? "top" : "bottom", node: <MapAddCard town={tap.town} label={tap.label} where={where} below={tap.below} onClose={() => setTap(null)} onAdd={() => addTap(slot)} /> });
    }
    return out;
    // Handlers read the latest plan when they run; the list covers what the icons show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dated, stops, active, step, interests, legOpen, legBelow, tap]);
  const framed = useRef("");
  useEffect(() => {
    const sig = stops.map((s) => s.key).join();
    if (!sig || sig === framed.current) return;
    framed.current = sig;
    // A stop added on the map itself keeps the globe still (it's where you're looking).
    if (onMap.current) {
      onMap.current = false;
      return;
    }
    frame(stops);
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

  const dated2 = nights.length === stops.length;
  /** A stop added at a place in the route (the end, by default); its key, or null when it can't be. */
  const insertAt = (i: number, p: Place, looking = false): string | null => {
    const at = Math.max(0, Math.min(stops.length, i));
    // The same city twice in a row makes no route (it can come back later: Lisbon, Porto, Lisbon).
    const same = (s?: Stop) => !!s && Math.abs(s.lat - p.lat) < 0.05 && Math.abs(s.lng - p.lng) < 0.05;
    if (!looking && (same(stops[at - 1]) || same(stops[at]))) {
      onMap.current = false;
      toast({ title: `${p.name} is already there`, emoji: "📍" });
      return null;
    }
    if (stops.length >= MAX_STOPS) {
      onMap.current = false;
      toast({ title: "Ten cities is the most for one trip", body: "Plan the rest as another trip.", emoji: "🧭" });
      return null;
    }
    const s = { ...keyed(p), looking: looking || undefined };
    setStops((x) => [...x.slice(0, at), s, ...x.slice(at)]);
    if (dated2) setNights((n) => nightsWithStop(n, at));
    setInserting(null);
    return s.key;
  };
  const add = (p: Place) => insertAt(stops.length, p);
  const addRegion = async (r: (typeof REGIONS)[number]) => {
    // One city at a time, so each one lands on the globe.
    let n = stops.length;
    for (const p of r.places) {
      if (n >= MAX_STOPS) break;
      setStops((s) => (s.length >= MAX_STOPS ? s : [...s, keyed(p)]));
      n++;
      await sleep(260);
    }
    if (!named) setEmoji(r.emoji);
  };
  const remove = (i: number) => {
    const gone = stops[i];
    const before = { stops, nights };
    if (!gone) return;
    smoothly(() => {
      setStops((s) => s.filter((x) => x.key !== gone.key));
      if (dated2) setNights((n) => nightsWithout(n, i));
    });
    setActive(undefined);
    toast({ title: `${gone.name} taken off the route`, emoji: "🗺️", action: { label: "Undo", run: () => (setStops(before.stops), setNights(before.nights)) } });
  };
  const moveTo = (from: number, to: number) =>
    smoothly(() => {
      setStops((s) => moved(s, from, to));
      if (dated2) setNights((n) => moved(n, from, to));
    });
  const rename = (i: number, v: string) => setStops((s) => s.map((x, j) => (j === i ? renamed(x, v) : x)));

  // Dragging a city on the globe: the route follows the finger (once a frame), and where it's
  // let go, the town there gives the stop its name (unless it has one of its own).
  const live = useRef<{ key: string; lat: number; lng: number } | null>(null);
  const frameReq = useRef(0);
  const follow = (key: string, lat: number, lng: number) => {
    live.current = { key, lat, lng };
    if (frameReq.current) return;
    frameReq.current = requestAnimationFrame(() => {
      frameReq.current = 0;
      const l = live.current;
      if (l) setStops((s) => s.map((x) => (x.key === l.key ? { ...x, lat: l.lat, lng: l.lng } : x)));
    });
  };
  const settle = async (key: string, lat: number, lng: number) => {
    cancelAnimationFrame(frameReq.current);
    frameReq.current = 0;
    live.current = null;
    const was = stopsNow.current.find((x) => x.key === key);
    setStops((s) => s.map((x) => (x.key === key ? { ...x, lat, lng, looking: true } : x)));
    const t = await lookupTown(lat, lng);
    setStops((s) => s.map((x) => (x.key === key ? { ...relocated(x, placeOfTown(t)), looking: undefined } : x)));
    if (was && placeOfTown(t).name !== (was.place || was.name))
      toast({ title: `Moved to ${t.name}`, body: was.place ? `Still called ${was.name}` : undefined, emoji: "📍", action: { label: "Undo", run: () => setStops((s) => s.map((x) => (x.key === key ? was : x))) } });
  };
  // A leg's "+" let go somewhere: a stop there, named after the town it's in.
  const dropOnLeg = async (i: number, lat: number, lng: number) => {
    setLegDrag(null);
    onMap.current = true;
    const key = insertAt(i + 1, { name: "…", lat, lng }, true);
    if (!key) return;
    const t = await lookupTown(lat, lng);
    setStops((s) => s.map((x) => (x.key === key ? { ...x, ...placeOfTown(t), looking: undefined } : x)));
  };
  const openLeg = (i: number) => {
    setTap(null);
    // On a phone, typing happens in the list (the keyboard would cover the globe anyway).
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      sheet.setSnap("full");
      setInserting(i + 1);
      return;
    }
    const m = midpoint(stops[i], stops[i + 1]);
    const at = api.current?.project([m.lng, m.lat]);
    setLegBelow(!!at && at.y < 330);
    setLegOpen(i);
  };
  // A tap on the map (on the first step): the town there, ready to add where it fits best.
  const tapMap = (c: MapClick) => {
    setActive(undefined);
    setLegOpen(null);
    if (step !== 0) return;
    if (tap) return setTap(null);
    const label = c.feature && SETTLEMENTS.has(c.feature.kind) ? c.feature.name : undefined;
    // Near the top of the screen, its card opens below the place instead of above.
    const at = api.current?.project([c.lng, c.lat]);
    setTap({ lat: c.lat, lng: c.lng, label, below: !!at && at.y < 240 });
    // On a phone, the sheet folds so the place and its card can be seen.
    sheet.setSnap("peek");
    void lookupTown(c.lat, c.lng).then((town) => setTap((t) => (t && t.lat === c.lat && t.lng === c.lng ? { ...t, town } : t)));
  };
  const addTap = (slot: number) => {
    if (!tap?.town) return;
    onMap.current = true;
    insertAt(slot, placeOfTown(tap.town, tap.label));
    setTap(null);
  };
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

  const canNext = step === 0 ? stops.length > 0 && !stops.some((s) => s.looking) : step === 1 ? !!start && !!end && nights.every((n) => n >= 0) : step === 3 ? !!name.trim() : true;
  const next = () => (step === 0 ? goWhen() : setStep((s) => Math.min(3, s + 1)));

  const totalNights = nights.reduce((a, b) => a + b, 0);
  const km = Math.round(routeKm(stops));
  const summary =
    step === 0
      ? stops.length
        ? `${stops.length} ${stops.length === 1 ? "city" : "cities"}${stops.length > 1 ? ` · ${km.toLocaleString("en-GB")} km` : ""}`
        : "No cities yet"
      : step === 1
        ? start && end
          ? `${totalNights} ${totalNights === 1 ? "night" : "nights"} · ${shortRange(start, end)}`
          : "Pick your dates"
        : step === 2
          ? interests.length
            ? `${interests.length} ${interests.length === 1 ? "thing" : "things"} you like`
            : "A bit of everything"
          : name || "Your trip";

  const create = async () => {
    const tripStops: TripStop[] = withNights(
      stops.map(({ key, ...p }) => {
        delete p.looking;
        return { ...p, id: key, from: "", to: "" };
      }),
      start,
      nights,
    );
    let id = editing;
    if (id) userActions.updateTrip(id, { name: name.trim(), emoji, interests, stops: tripStops, start, end });
    else {
      // The events the trip was planned around come with it.
      const snaps = Object.fromEntries(withEvents.map((c) => [c.id, { ...tripSnapOf(c), id: undefined }]));
      id = userActions.createTrip(name.trim(), start, end, withEvents.map((c) => c.id), { stops: tripStops, emoji, interests, snaps: withEvents.length ? snaps : undefined });
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
      <TripGlobe api={api} route={route} fly={fly} pad={pad} onReady={() => setReady(true)} onBackground={tapMap} label="Globe showing the trip you're planning: its cities and the route between them. Drag a city to move it; tap the map to add a place." />
      <MapIcons api={api} ready={ready} icons={icons} />
      <section
        ref={sheet.panel}
        className="planner-panel"
        aria-label="Plan a trip"
        data-snap={sheet.snap}
        // Typing gets the whole sheet (the keyboard takes the rest of the screen).
        onFocusCapture={(e) => {
          const t = e.target as HTMLElement;
          if (t.matches("input:not([type=date]):not([type=checkbox]), textarea")) sheet.setSnap("full");
        }}
      >
        <SheetGrab snap={sheet.snap} grab={sheet.grab} label="The planner" />
        <header className="planner-head is-steps">
          <h1 className="planner-title t-h2 font-display-tight">{editing ? "Edit your trip" : "Plan a trip"}</h1>
          <Link href="/trips" className="planner-close btn btn-ghost btn-icon btn-sm" aria-label="Close the planner">
            <X size={18} aria-hidden />
          </Link>
          <ol className="planner-steps" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button type="button" className="planner-step" aria-current={i === step ? "step" : undefined} data-done={i < step || undefined} disabled={i > step && !(i === 1 && stops.length) && !(i > 1 && end)} onClick={() => (i === 1 && step === 0 ? goWhen() : setStep(i))} aria-label={`Step ${i + 1}: ${s}${i < step ? ", done" : ""}`}>
                  <span className="planner-step-n" aria-hidden>{i < step ? <Check size={12} /> : i + 1}</span> <span className="planner-step-label" aria-hidden>{s}</span>
                </button>
              </li>
            ))}
          </ol>
        </header>

        <div className="planner-body" key={step}>
          {step === 0 && (
            <>
              <p className="planner-q">{stops.length ? "Where else?" : "Where are you going?"}</p>
              <PlaceSearch onPick={add} placeholder={stops.length ? "Add another city…" : undefined} />
              {!stops.length && (
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
              )}
              {stops.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="t-small font-semibold">Your route, in order</p>
                    {stops.length > 2 && saved > 20 && (
                      <button type="button" className="btn btn-ghost btn-sm text-cyan" onClick={reorder}>
                        <Wand2 size={14} aria-hidden /> Shortest order
                      </button>
                    )}
                  </div>
                  <RouteList stops={stops} onMove={moveTo} onRemove={remove} onRename={rename} onInsert={(i, p) => insertAt(i, p)} inserting={inserting} setInserting={setInserting} onHover={setActive} onPick={(i) => frame([stops[i]])} />
                  {stops.length > 1 && <p className="t-micro text-text-3 mt-2 tnum">{Math.round(routeKm(stops)).toLocaleString("en-GB")} km from first to last city</p>}
                  {hint && (
                    <div className="planner-hint t-micro">
                      <Hand size={13} aria-hidden className="shrink-0 mt-px" />
                      <span className="flex-1">On the globe: drag a city to move it, tap <b>+</b> on the line to stop on the way (or drag it), or tap anywhere to add that place. Tap a name to call it what you like.</span>
                      <button
                        type="button"
                        className="planner-hint-ok"
                        onClick={() => {
                          setHint(false);
                          try {
                            localStorage.setItem("omnievent:hint:route", "1");
                          } catch {
                            // storage off
                          }
                        }}
                      >
                        Got it
                      </button>
                    </div>
                  )}
                  <details className="planner-more">
                    <summary>
                      <span>Add a ready-made route</span> <ChevronDown size={14} aria-hidden />
                    </summary>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {REGIONS.map((r) => (
                        <button key={r.id} type="button" className="chip press" onClick={() => void addRegion(r)}>
                          <span aria-hidden>{r.emoji}</span> {r.name}
                        </button>
                      ))}
                    </div>
                  </details>
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
                <TripPass name={name || "My trip"} emoji={emoji} stops={stops} start={start} end={end} events={withEvents.length} />
                {stamped && <span className="pass-stamp" aria-hidden>Let&apos;s go!</span>}
              </div>
              {stamped && <p className="sr-only" role="status">Trip saved. Opening it…</p>}
              {withEvents.length > 0 && <p className="t-small text-text-2 mt-3"><Sparkles size={14} className="inline text-sun" aria-hidden /> {withEvents.length === 1 ? `${withEvents[0].title} comes with it.` : `${withEvents.length} events you saved come with it.`}</p>}
            </>
          )}
        </div>

        <footer className="planner-foot">
          {step > 0 ? (
            <button type="button" className="btn btn-ghost planner-back" onClick={() => setStep((s) => s - 1)} aria-label="Back"><ArrowLeft size={16} aria-hidden /> <span className="max-sm:hidden">Back</span></button>
          ) : <span className="max-sm:hidden" />}
          <p className="planner-sum" aria-live="polite">{summary}</p>
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
