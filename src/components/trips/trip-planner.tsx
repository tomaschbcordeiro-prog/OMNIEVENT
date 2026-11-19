"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Hand, Loader2, Plane, Sparkles, Users, Wand2, X } from "lucide-react";
import { getDestination } from "@/lib/destinations";
import { GROUPS } from "@/lib/categories";
import { getUser, userActions } from "@/lib/user/store";
import { addDays, bestOrder, bestSlot, countryRuns, midpoint, routeFromEvents, moveBoundary, runOrder, moved, nightsBetween, nightsWithout, nightsWithStop, REGIONS, relocated, renamed, rescaleNights, routeKm, splitNights, stopColor, suggestName, withNights, type Place, type TripStop } from "@/lib/trip";
import type { Town } from "@/lib/town";
import type { EventCard } from "@/lib/types";
import type { EarthMapHandle, FlyRequest, MapClick } from "../earth/earth-map";
import { parseRouteParam } from "@/lib/travel/route-param";
import { bboxOf, CityPin, dayLabel, MapIcons, routeOf, SheetGrab, shortRange, TripGlobe, TripPass, tripSnapOf, usePanelPad, useSheet, type MapIcon } from "./shared";
import { localDateKey } from "@/lib/format";
import { toast } from "../toast";
import { LegPlus, lookupTown, MapAddCard, PlaceSearch, placeOfTown, RouteList, type RouteStop } from "./route-edit";
import { DatesRow, RangeCalendar, shortDay } from "./range-calendar";
import { listReorder, startLift } from "@/lib/lift";

type Stop = RouteStop;
/** Two steps, then the trip exists: where, and how long in each place. Everything else (events,
 * hotels, travel, friends) is added on the trip itself, whenever the traveller likes. */
const STEPS = ["Where", "How long"] as const;
const LAST = STEPS.length - 1;
const EMOJIS = ["✈️", "🌍", "🚆", "🚗", "🎒", "🎉", "🌴", "🏔️", "🎭", "🎶"];
const RADIUS_KM = 30;
const MAX_STOPS = 10;
/** Map labels that name a town (tapping one adds it by that name). */
const SETTLEMENTS = new Set(["city", "town", "village", "hamlet", "suburb", "locality"]);
let keySeq = 0;
const keyed = (p: Place): Stop => ({ ...p, key: `k${Date.now().toString(36)}${keySeq++}` });
const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A trip has at least one night (a city can be a day trip, the whole trip can't). */
const totalOk = (n: number[]) => n.reduce((a, b) => a + b, 0) >= 1;
/** Reorders smoothly where the browser can (each stop keeps its place on screen as it moves). */
const smoothly = (fn: () => void) => {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (d.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) d.startViewTransition(fn);
  else fn();
};

/**
 * Plan a trip in two steps: where (any cities, or a ready-made route), then how long in each
 * place (and from when). That's a trip: it's created there and then, and everything else is
 * added on it at the traveller's own pace. The globe answers every choice: cities drop in and
 * the route draws itself.
 */
export function TripPlanner() {
  const router = useRouter();
  const sp = useSearchParams();
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
  const [emojiOpen, setEmojiOpen] = useState(false);
  /** The calendar open to change dates already picked. */
  const [datesOpen, setDatesOpen] = useState(false);
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
    // The saved data itself (on a page opened straight from its address, the first render
    // still has the empty server copy).
    const user = getUser();
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
    // A whole route (a trip idea, or a trip someone shared): its stops, nights and name.
    const route = sp.get("route") ? parseRouteParam(sp.get("route")!) : [];
    if (route.length && !first.length) {
      route.forEach((p) => first.push(keyed({ name: p.name, countryCode: p.countryCode, lat: p.lat, lng: p.lng, cityId: p.cityId })));
      setStart(addDays(today(), 21));
      setNights(route.map((p) => Math.max(1, p.nights)));
      const nm = sp.get("name")?.trim();
      if (nm) {
        setName(nm.slice(0, 80));
        setNamed(true);
      }
      const em = sp.get("emoji");
      if (em && [...em].length <= 4 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(em)) setEmoji(em);
    }
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
  const icons = useMemo<MapIcon[]>(() => {
    const out: MapIcon[] = dated.map((s, i) => ({
      key: s.key,
      lat: s.lat,
      lng: s.lng,
      anchor: "bottom",
      node: <CityPin n={i + 1} name={s.name} color={stopColor(i)} active={active === i} looking={s.looking} hint="Drag to move it" note={s.from && s.to ? `${nightsBetween(s.from, s.to)}n` : undefined} onClick={() => setActive((a) => (a === i ? undefined : i))} />,
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
  }, [dated, stops, active, step, legOpen, legBelow, tap]);
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

  // The name writes itself until it's typed over (and only once there's a route: on the first
  // render of a trip being edited, its own name is still on its way in).
  useEffect(() => {
    if (!named && stops.length) setName(suggestName(stops, start || undefined));
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
  /** A stop moved in the order (carried there by a drag, it settles by itself). */
  const moveTo = (from: number, to: number, dragged = false) => {
    const run = () => {
      setStops((s) => moved(s, from, to));
      if (dated2) setNights((n) => moved(n, from, to));
    };
    if (dragged) run();
    else smoothly(run);
  };
  /** A whole country (its cities in a row) moved before or after another. */
  const moveRun = (from: number, to: number) => {
    const runs = countryRuns(stops);
    const order = runOrder(runs, from, to);
    const before = { stops, nights };
    setStops(order.map((k) => stops[k]));
    if (dated2) setNights(order.map((k) => nights[k]));
    toast({ title: `${runs[from].country ?? "Those cities"} moved`, body: order.map((k) => stops[k].name).join(" → "), emoji: runs[from].flag || "🧭", action: { label: "Undo", run: () => (setStops(before.stops), setNights(before.nights)) } });
  };
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

  /** New dates for the whole trip: each city keeps its share of it. */
  const setRange = (s: string, e: string) => {
    setStart(s);
    setNights((n) => rescaleNights(n.length === stops.length ? n : stops.map(() => 0), nightsBetween(s, e)));
    setDatesOpen(false);
  };
  const goWhen = () => {
    setStepState(1);
    // On a phone the whole step shows at once (every city's nights, the dates, the name).
    sheet.setSnap("full");
  };

  const canNext = step === 0 ? stops.length > 0 && !stops.some((s) => s.looking) : !!start && !!end && nights.length === stops.length && nights.every((n) => n >= 0) && totalOk(nights);
  const next = () => goWhen();

  const totalNights = nights.reduce((a, b) => a + b, 0);
  const km = Math.round(routeKm(stops));
  const summary =
    step === 0
      ? stops.length
        ? `${stops.length} ${stops.length === 1 ? "city" : "cities"}${stops.length > 1 ? ` · ${km.toLocaleString("en-GB")} km` : ""}`
        : "No cities yet"
      : start && end
        ? `${totalNights} ${totalNights === 1 ? "night" : "nights"} · ${shortRange(start, end)}`
        : "Pick your dates";

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
    // A name left empty takes the one the route suggests.
    const title = name.trim() || suggestName(stops, start || undefined);
    if (id) userActions.updateTrip(id, { name: title, emoji, interests, stops: tripStops, start, end });
    else {
      // The events the trip was planned around come with it.
      const snaps = Object.fromEntries(withEvents.map((c) => [c.id, { ...tripSnapOf(c), id: undefined }]));
      id = userActions.createTrip(title, start, end, withEvents.map((c) => c.id), { stops: tripStops, emoji, interests, snaps: withEvents.length ? snaps : undefined });
    }
    // The pass gets its stamp, then the trip opens.
    setStamped(true);
    try {
      navigator.vibrate?.([10, 50, 16]);
    } catch {
      // no vibration here
    }
    await sleep(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 1100);
    // Planned to go with friends: the invitation opens straight away.
    router.push(editing ? `/trips/${id}` : `/trips/${id}?hello=1${sp.get("together") ? "&invite=1" : ""}`);
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
                <button type="button" className="planner-step" aria-current={i === step ? "step" : undefined} data-done={i < step || undefined} disabled={i > step && !stops.length} onClick={() => (i === 1 && step === 0 ? goWhen() : setStep(i))} aria-label={`Step ${i + 1}: ${s}${i < step ? ", done" : ""}`}>
                  <span className="planner-step-n" aria-hidden>{i < step ? <Check size={12} /> : i + 1}</span> <span className="planner-step-label" aria-hidden>{s}</span>
                </button>
              </li>
            ))}
          </ol>
        </header>

        <div className="planner-body" key={step} data-lift-scroll>
          {step === 0 && (
            <>
              <p className="planner-q">{stops.length ? "Where else?" : "Where are you going?"}</p>
              {!stops.length && !editing && <p className="planner-lede">Just the places and how long in each. Events, hotels, travel and friends come later, whenever you like.</p>}
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
                    <Link href="/trips/ideas" className="chip chip-link press font-semibold">✨ Endless ideas <ArrowRight size={13} aria-hidden /></Link>
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
                  <CountryOrder stops={stops} onMove={moveRun} onPick={(a, b) => frame(stops.slice(a, b + 1))} />
                  <RouteList stops={stops} onMove={moveTo} onRemove={remove} onRename={rename} onInsert={(i, p) => insertAt(i, p)} inserting={inserting} setInserting={setInserting} onHover={setActive} onPick={(i) => frame([stops[i]])} />
                  {stops.length > 1 && <p className="t-micro text-text-3 mt-2 tnum">{Math.round(routeKm(stops)).toLocaleString("en-GB")} km from first to last city</p>}
                  {hint && (
                    <div className="planner-hint t-micro">
                      <Hand size={13} aria-hidden className="shrink-0 mt-px" />
                      <span className="flex-1">Hold a city in the list and drag it to change the order. On the globe: drag a city to move it, tap <b>+</b> on the line to stop on the way, or tap anywhere to add that place. Tap a name to call it what you like.</span>
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
                      <Link href="/trips/ideas" className="chip chip-link press font-semibold">✨ More ideas <ArrowRight size={13} aria-hidden /></Link>
                    </div>
                  </details>
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <p className="planner-q">When are you going?</p>
              {start && end && !datesOpen ? (
                <DatesRow start={start} end={end} onOpen={() => setDatesOpen(true)} />
              ) : (
                <RangeCalendar start={start} end={end} min={today()} onChange={setRange} />
              )}

              {start && end && stops.length > 0 && (
                <>
                  <h2 className="planner-sub">{stops.length > 1 ? "Nights in each place" : "Your stay"}</h2>
                  {stops.length > 1 && <p className="planner-note">Drag the white handles to share the nights out. Hold a city and slide it to change the order.</p>}
                  <NightsBar stops={dated as (Stop & { from: string; to: string })[]} nights={nights} onChange={setNights} onFocusStop={setActive} onPick={(i) => frame([stops[i]])} onReorder={(from, to) => moveTo(from, to, true)} />
                  <NightsLegend stops={dated as (Stop & { from: string; to: string })[]} nights={nights} interests={interests} onFocusStop={setActive} onPick={(i) => frame([stops[i]])} />
                </>
              )}

              <h2 className="planner-sub">Name</h2>
              <div className="planner-name-row">
                <button type="button" className="emoji-btn press" aria-expanded={emojiOpen} aria-label={`Trip emoji: ${emoji}. Change it`} onClick={() => setEmojiOpen((o) => !o)}>
                  <span aria-hidden>{emoji}</span>
                </button>
                <input className="field" value={name} maxLength={60} placeholder={suggestName(stops, start || undefined)} onChange={(e) => (setName(e.target.value), setNamed(true))} aria-label="Trip name" />
              </div>
              {emojiOpen && (
                <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Trip emoji">
                  {EMOJIS.map((e) => (
                    <button key={e} type="button" role="radio" aria-checked={emoji === e} className="emoji-pick press" onClick={() => (setEmoji(e), setEmojiOpen(false))}>{e}</button>
                  ))}
                </div>
              )}
              <p className="t-micro text-text-3 mt-1.5">You can change all of this later.</p>
              {withEvents.length > 0 && <p className="t-small text-text-2 mt-4"><Sparkles size={14} className="inline text-sun" aria-hidden /> {withEvents.length === 1 ? `${withEvents[0].title} comes with it.` : `${withEvents.length} events you saved come with it.`}</p>}
              {sp.get("together") && <p className="t-small text-text-2 mt-2"><Users size={14} className="inline text-cyan" aria-hidden /> Next: invite your friends with a link or a PIN, and plan it together.</p>}
            </>
          )}
        </div>

        <footer className="planner-foot">
          {step > 0 ? (
            <button type="button" className="btn btn-ghost planner-back" onClick={() => setStep((s) => s - 1)} aria-label="Back"><ArrowLeft size={16} aria-hidden /> <span className="max-sm:hidden">Back</span></button>
          ) : <span className="max-sm:hidden" />}
          <p className="planner-sum" aria-live="polite">{summary}</p>
          {step < LAST ? (
            <button type="button" className="btn btn-primary press" disabled={!canNext} onClick={next}>
              {stops.length ? "Next: how long" : "Add a city"} <ArrowRight size={16} aria-hidden />
            </button>
          ) : (
            <button type="button" className="btn btn-primary press" disabled={!canNext || stamped} onClick={() => void create()}>
              <Plane size={16} aria-hidden /> {editing ? "Save trip" : "Create trip"}
            </button>
          )}
        </footer>
      </section>
      {stamped && (
        // Created: the trip's pass, stamped, for a moment; then the trip opens.
        <div className="planner-stamp" role="status">
          <div className="planner-stamp-card">
            <TripPass name={name.trim() || suggestName(stops, start || undefined)} emoji={emoji} stops={stops} start={start} end={end} events={withEvents.length} />
            <span className="pass-stamp" aria-hidden>{editing ? "Saved" : "Let’s go!"}</span>
          </div>
          <p className="sr-only">{editing ? "Trip saved. Opening it…" : "Trip created. Opening it…"}</p>
        </div>
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
 * The route's countries in order, as flags: hold one (or drag it with the mouse) and slide it
 * before or after another, and all its cities move with it. Shown once the route crosses a
 * border. Arrow keys move the one in focus; a tap shows its cities on the globe.
 */
function CountryOrder({ stops, onMove, onPick }: { stops: Stop[]; onMove: (from: number, to: number) => void; onPick: (from: number, to: number) => void }) {
  const row = useRef<HTMLOListElement>(null);
  const [held, setHeld] = useState(false);
  const runs = countryRuns(stops);
  if (runs.length < 2) return null;
  const carry = (e: React.PointerEvent<HTMLElement>, i: number) => {
    if (!row.current) return;
    const order = listReorder({ box: row.current, from: i, axis: "x", onDrop: (to) => onMove(i, to) });
    startLift(e, { lift: (p) => (setHeld(true), order.lift(p)), move: order.move, drop: (p) => (setHeld(false), order.drop(p)), cancel: () => (setHeld(false), order.cancel()) }, { slop: 5 });
  };
  return (
    <section className="cty" aria-labelledby="cty-h">
      <div className="cty-head">
        <h3 id="cty-h" className="cty-title">Countries, in order</h3>
        <span className="cty-hint">Hold one and slide it</span>
      </div>
      <ol ref={row} className="cty-row" data-held={held || undefined}>
        {runs.map((r, i) => {
          const n = r.to - r.from + 1;
          return (
            <li key={stops[r.from].key} className="cty-item">
              <button
                type="button"
                className="cty-chip"
                onPointerDown={(e) => carry(e, i)}
                onClick={() => onPick(r.from, r.to)}
                onKeyDown={(e) => {
                  const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : -1;
                  if (to < 0 || to >= runs.length) return;
                  e.preventDefault();
                  onMove(i, to);
                }}
                aria-label={`${r.country ?? r.code}: ${n} ${n === 1 ? "city" : "cities"}, ${stops.slice(r.from, r.to + 1).map((s) => s.name).join(", ")}. Hold and slide, or use the left and right arrow keys, to move it`}
              >
                <span className="cty-flag" aria-hidden>{r.flag || "🏳️"}</span>
                <span className="cty-text">
                  <span className="cty-name">{r.country ?? r.code}</span>
                  <span className="cty-dots" aria-hidden>
                    {Array.from({ length: n }, (_, k) => <i key={k} style={{ background: stopColor(r.from + k) }} />)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The trip as one bar, a coloured stretch per city as long as its nights, with the days of the
 * trip ticked underneath. Between two cities, a handle to drag (or focus and move with the arrow
 * keys): it snaps night by night, shows the day you'd move on, and gives a little tick on phones
 * that can. Tapping a stretch shows that city on the globe.
 */
function NightsBar({ stops, nights, onChange, onFocusStop, onPick, onReorder }: { stops: (Stop & { from: string; to: string })[]; nights: number[]; onChange: (n: number[]) => void; onFocusStop: (i?: number) => void; onPick: (i: number) => void; onReorder: (from: number, to: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  /** A city's stretch held and slid along the bar: the cities change order, nights and all. */
  const carry = (e: React.PointerEvent<HTMLElement>, i: number) => {
    if (stops.length < 2 || !track.current) return;
    startLift(e, listReorder({ box: track.current, from: i, axis: "x", onDrop: (to) => onReorder(i, to) }), { slop: 6 });
  };
  const drag = useRef<{ i: number; base: number[] } | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  const total = Math.max(1, nights.reduce((a, b) => a + b, 0));
  const start = stops[0]?.from ?? "";
  /** Nights before the handle after stop i (where it sits on the bar). */
  const upTo = (n: number[], i: number) => n.slice(0, i + 1).reduce((a, b) => a + b, 0);
  const pct = (k: number) => `${(k / total) * 100}%`;
  const set = (next: number[]) => {
    if (next.every((v, j) => v === nights[j])) return;
    onChange(next);
    try {
      navigator.vibrate?.(4);
    } catch {
      // no vibration here
    }
  };
  const follow = (e: React.PointerEvent) => {
    const d = drag.current;
    const box = track.current?.getBoundingClientRect();
    if (!d || !box) return;
    const k = Math.round(((e.clientX - box.left) / box.width) * total);
    set(moveBoundary(d.base, d.i, k - upTo(d.base, d.i)));
  };
  const letGo = () => {
    drag.current = null;
    setHeld(null);
  };
  // Day ticks: every day on a short trip, fewer on a long one (each label needs room).
  const every = total <= 10 ? 1 : total <= 21 ? 2 : 7;
  return (
    <div className="nb" data-held={held !== null || undefined}>
      <div ref={track} className="nb-track">
        {stops.map((s, i) => {
          const n = nights[i] ?? 0;
          return (
            <button
              key={s.key}
              type="button"
              className="nb-seg"
              data-small={n / total < 0.17 || undefined}
              style={{ "--n": n, "--ink": stopColor(i) } as React.CSSProperties}
              onClick={() => onPick(i)}
              onPointerDown={(e) => carry(e, i)}
              onMouseEnter={() => onFocusStop(i)}
              onMouseLeave={() => onFocusStop(undefined)}
              aria-label={`${s.name}: ${n} ${n === 1 ? "night" : "nights"}, ${shortRange(s.from, s.to)}. Show on the globe (hold and slide it to change the order)`}
            >
              <span className="nb-seg-name">{s.name}</span>
              <span className="nb-seg-n tnum">
                <b key={n}>{n}</b>
                <span>{n === 1 ? "night" : "nights"}</span>
              </span>
            </button>
          );
        })}
      </div>
      {stops.slice(0, -1).map((s, i) => {
        const k = upTo(nights, i);
        const day = addDays(start, k);
        const next = stops[i + 1];
        return (
          <div
            key={`h-${s.key}`}
            className="nb-knob"
            data-held={held === i || undefined}
            style={{ "--x": pct(k) } as React.CSSProperties}
            role="slider"
            tabIndex={0}
            aria-label={`Move on from ${s.name} to ${next.name}`}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={k}
            aria-valuetext={`${s.name} ${nights[i]} ${nights[i] === 1 ? "night" : "nights"}, ${next.name} ${nights[i + 1]} ${nights[i + 1] === 1 ? "night" : "nights"}. Move on ${shortDay(day)}`}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              drag.current = { i, base: nights };
              setHeld(i);
            }}
            onPointerMove={follow}
            onPointerUp={letGo}
            onPointerCancel={letGo}
            onLostPointerCapture={letGo}
            onKeyDown={(e) => {
              const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              set(moveBoundary(nights, i, step));
            }}
          >
            <span className="nb-knob-grip" aria-hidden />
            <span className="nb-tip tnum" aria-hidden>{shortDay(day)}</span>
          </div>
        );
      })}
      <div className="nb-days" aria-hidden>
        {Array.from({ length: total + 1 }, (_, k) => {
          const d = addDays(start, k);
          // The first and last days carry the month: their neighbours stay unlabelled to leave room.
          const label = k === 0 || k === total || (k % every === 0 && k >= 2 && k <= total - 2);
          return (
            <span key={k} className="nb-day tnum" data-edge={k === 0 ? "start" : k === total ? "end" : undefined} style={{ "--x": pct(k) } as React.CSSProperties}>
              <i />
              {label && <span>{k === 0 || k === total ? fmtDay(d) : Number(d.slice(8))}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Each city's days and nights in words, with what's on there then; a tap shows it on the globe. */
function NightsLegend({ stops, nights, interests, onFocusStop, onPick }: { stops: (Stop & { from: string; to: string })[]; nights: number[]; interests: string[]; onFocusStop: (i?: number) => void; onPick: (i: number) => void }) {
  const counts = useCounts(stops, interests);
  return (
    <>
      <ol className="nb-legend">
        {stops.map((s, i) => {
          const n = nights[i] ?? 0;
          const c = counts[s.key];
          return (
            <li key={s.key} style={{ "--ink": stopColor(i) } as React.CSSProperties}>
              <button type="button" className="nb-row" onClick={() => onPick(i)} onMouseEnter={() => onFocusStop(i)} onMouseLeave={() => onFocusStop(undefined)}>
                <span className="planner-stop-n" aria-hidden>{i + 1}</span>
                <span className="nb-row-main">
                  <span className="nb-row-name">{s.name}</span>
                  <span className="nb-row-when tnum">{n === 0 ? `${dayLabel(s.from)}, a day trip` : `${dayLabel(s.from)} → ${dayLabel(s.to)}`}</span>
                </span>
                <span className="nb-row-side tnum">
                  <b>{n} {n === 1 ? "night" : "nights"}</b>
                  <span>{c == null ? <Loader2 size={11} className="animate-spin" aria-label="Counting events" /> : c > 0 ? `${c.toLocaleString("en-GB")} on` : "quiet"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {stops.length > 1 && nights.some((n) => n === 0) && <p className="t-micro text-text-2 mt-2">A day trip: you pass through on a travel day, without sleeping there.</p>}
    </>
  );
}
