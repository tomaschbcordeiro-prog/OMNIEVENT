"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Heart, LocateFixed, MapPin, RotateCcw, Sparkles, X } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { GROUPS } from "@/lib/categories";
import { formatEventTime, formatShortDate } from "@/lib/format";
import { userActions, useUser } from "@/lib/user/store";
import { CategoryIcon, Poster, Price, categoryLabel } from "../ui";
import { toast } from "../toast";

/**
 * Event Match: one event at a time, as a card to swipe. Right (or ♥) saves it to My World,
 * left passes, up opens it. Cards already seen this week are skipped, so every visit shows
 * something new. Works with touch, mouse and the arrow keys.
 */

type When = "tonight" | "weekend" | "month";
type Where = { kind: "anywhere" } | { kind: "near"; lat: number; lng: number; label: string };

const VIBES = ["music", "sports", "theatre", "comedy", "festivals", "exhibitions", "food-drink", "nightlife", "family", "outdoor"];
const SEEN_KEY = "omnievent:match-seen:v1";
const WEEK = 7 * 86400000;

function readSeen(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, t]) => now - t < WEEK));
  } catch {
    return {};
  }
}
function writeSeen(seen: Record<string, number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // private mode: this visit only
  }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function range(when: When): { from: string; to: string } {
  const now = new Date();
  if (when === "tonight") return { from: ymd(now), to: ymd(now) };
  if (when === "weekend") {
    const day = now.getDay();
    const fri = new Date(now.getTime() + ((5 - day + 7) % 7) * 86400000);
    const start = day === 0 || day === 6 ? now : fri;
    const sun = new Date(start.getTime() + ((7 - start.getDay()) % 7) * 86400000);
    return { from: ymd(start), to: ymd(sun) };
  }
  return { from: ymd(now), to: ymd(new Date(now.getTime() + 30 * 86400000)) };
}

export function MatchDeck() {
  const user = useUser();
  const [when, setWhen] = useState<When>("weekend");
  const [where, setWhere] = useState<Where>({ kind: "anywhere" });
  const [vibe, setVibe] = useState<string | null>(null);
  const [deck, setDeck] = useState<EventCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<{ card: EventCard; saved: boolean }[]>([]);
  const [fly, setFly] = useState<{ id: string; dir: "left" | "right" | "up" } | null>(null);
  const seen = useRef<Record<string, number>>({});
  const savedIds = useMemo(() => new Set(user.saved.map((s) => s.id)), [user.saved]);
  const savedThisVisit = history.filter((h) => h.saved).map((h) => h.card);

  useEffect(() => {
    seen.current = readSeen();
  }, []);

  // Pages of events, fetched as the deck runs low; a new search starts over.
  const gen = useRef(0);
  const nextPage = useRef(1);
  const fetching = useRef(false);
  const finished = useRef(false);

  const load = useCallback(async () => {
    if (fetching.current || finished.current) return;
    fetching.current = true;
    setLoading(true);
    const g = gen.current;
    const { from, to } = range(when);
    try {
      // Skip pages where everything was seen already, a few at a time.
      for (let tries = 0; tries < 4; tries++) {
        const page = nextPage.current++;
        const p = new URLSearchParams({ from, to, size: "40", page: String(page), sort: "relevance" });
        if (vibe) p.set("cat", vibe);
        if (where.kind === "near") {
          p.set("lat", where.lat.toFixed(3));
          p.set("lng", where.lng.toFixed(3));
          p.set("radius", "60");
        }
        const json = (await (await fetch(`/api/events?${p}`)).json()) as { items?: EventCard[]; total?: number };
        if (g !== gen.current) return;
        const items = (json.items ?? []).filter((c) => !seen.current[c.id] && !savedIds.has(c.id));
        // Pictures first: a deck of photos is what makes this fun.
        items.sort((a, b) => Number(!!b.imageUrl) - Number(!!a.imageUrl));
        setDeck((d) => [...d, ...items.filter((c) => !d.some((x) => x.id === c.id))]);
        if (!json.items?.length || page * 40 >= (json.total ?? 0) || page >= 25) {
          finished.current = true;
          break;
        }
        if (items.length) break;
      }
    } catch {
      if (g === gen.current) {
        finished.current = true;
      }
    } finally {
      if (g === gen.current) {
        fetching.current = false;
        setLoading(false);
      }
    }
  }, [when, where, vibe, savedIds]);

  useEffect(() => {
    gen.current++;
    nextPage.current = 1;
    fetching.current = false;
    finished.current = false;
    setDeck([]);
  }, [when, where, vibe]);

  useEffect(() => {
    if (deck.length <= 4) void load();
  }, [deck.length, load]);

  const top = deck[0];

  const decide = useCallback(
    (dir: "left" | "right" | "up") => {
      if (!top || fly) return;
      if (dir === "up") {
        window.open(`/events/${top.slug}`, "_self");
        return;
      }
      setFly({ id: top.id, dir });
      seen.current = { ...seen.current, [top.id]: Date.now() };
      writeSeen(seen.current);
      const saved = dir === "right";
      if (saved && !savedIds.has(top.id)) {
        userActions.toggleSave(top.id);
        try {
          navigator.vibrate?.(12);
        } catch {
          // no vibration
        }
      }
      setHistory((h) => [{ card: top, saved }, ...h].slice(0, 30));
      window.setTimeout(() => {
        setDeck((d) => d.slice(1));
        setFly(null);
      }, 260);
    },
    [top, fly, savedIds],
  );

  const undo = () => {
    const last = history[0];
    if (!last || fly) return;
    if (last.saved && savedIds.has(last.card.id)) userActions.toggleSave(last.card.id);
    const { [last.card.id]: _, ...rest } = seen.current;
    void _;
    seen.current = rest;
    writeSeen(rest);
    setHistory((h) => h.slice(1));
    setDeck((d) => [last.card, ...d]);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") decide("right");
      else if (e.key === "ArrowLeft") decide("left");
      else if (e.key === "ArrowUp") decide("up");
      else if (e.key === "Backspace") undo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const locate = () => {
    if (where.kind === "near") return setWhere({ kind: "anywhere" });
    if (!navigator.geolocation) return toast({ title: "Location isn't available in this browser", emoji: "📍" });
    navigator.geolocation.getCurrentPosition(
      (pos) => setWhere({ kind: "near", lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Near me" }),
      () => toast({ title: "We couldn't get your location", body: "Showing events anywhere instead.", emoji: "📍" }),
      { maximumAge: 600000, timeout: 10000 },
    );
  };

  return (
    <div className="mx-auto max-w-[520px] px-4 pt-6 pb-10">
      <div className="text-center">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-sun/15 px-3 py-1 t-small font-semibold"><Sparkles size={14} className="text-sun" aria-hidden /> Event Match</p>
        <h1 className="t-h1 mt-3">Swipe your next plan</h1>
        <p className="t-small text-text-2 mt-1">Right to save it, left to pass, up to open. Arrow keys work too.</p>
      </div>

      <div className="mt-5 grid gap-2">
        <div className="flex flex-wrap justify-center gap-1.5">
          {(["tonight", "weekend", "month"] as When[]).map((w) => (
            <button key={w} type="button" aria-pressed={when === w} onClick={() => setWhen(w)} className={`chip press ${when === w ? "bg-text text-white border-text" : ""}`}>
              {w === "tonight" ? "Tonight" : w === "weekend" ? "This weekend" : "Next 30 days"}
            </button>
          ))}
          <button type="button" aria-pressed={where.kind === "near"} onClick={locate} className={`chip press ${where.kind === "near" ? "bg-cyan text-white border-cyan" : ""}`}>
            <LocateFixed size={14} aria-hidden /> Near me
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 sm:justify-center sm:flex-wrap">
          <button type="button" aria-pressed={!vibe} onClick={() => setVibe(null)} className={`chip press shrink-0 ${!vibe ? "bg-text text-white border-text" : ""}`}>Any vibe</button>
          {VIBES.map((v) => (
            <button key={v} type="button" aria-pressed={vibe === v} onClick={() => setVibe(vibe === v ? null : v)} className={`chip press shrink-0 ${vibe === v ? "bg-text text-white border-text" : ""}`}>
              <CategoryIcon slug={v} size={13} /> {GROUPS.find((g) => g.slug === v)?.name.split(" &")[0] ?? v}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-5 h-[min(560px,64dvh)]" aria-live="polite">
        {deck.slice(0, 3).reverse().map((c, i, arr) => {
          const depth = arr.length - 1 - i;
          return depth === 0 ? (
            <SwipeCard key={c.id} card={c} fly={fly?.id === c.id ? fly.dir : null} onDecide={decide} />
          ) : (
            <div key={c.id} aria-hidden className="absolute inset-0 rounded-[28px] overflow-hidden bg-panel shadow-lg transition-transform duration-300" style={{ transform: `translateY(${depth * 12}px) scale(${1 - depth * 0.04})`, opacity: 1 - depth * 0.25 }}>
              <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} className="h-full w-full" />
            </div>
          );
        })}
        {!top && (
          <div className="absolute inset-0 grid place-items-center rounded-[28px] border-2 border-dashed border-line text-center p-6">
            {loading ? (
              <div>
                <div className="skeleton mx-auto h-40 w-40 rounded-full" aria-hidden />
                <p className="t-small text-text-2 mt-4">Finding events…</p>
              </div>
            ) : (
              <div>
                <p className="text-4xl" aria-hidden>🎉</p>
                <p className="t-h3 mt-2">You&apos;ve seen everything here</p>
                <p className="t-small text-text-2 mt-1">Try other dates, another vibe or events anywhere.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {when !== "month" && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setWhen("month")}>Next 30 days</button>}
                  {vibe && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setVibe(null)}>Any vibe</button>}
                  {where.kind === "near" && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setWhere({ kind: "anywhere" })}>Anywhere</button>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-center gap-4">
        <button type="button" className="match-btn h-12 w-12 text-text-2" aria-label="Undo" title="Undo (Backspace)" onClick={undo} disabled={!history.length}>
          <RotateCcw size={20} aria-hidden />
        </button>
        <button type="button" className="match-btn h-16 w-16 text-bad" aria-label="Pass" title="Pass (←)" onClick={() => decide("left")} disabled={!top}>
          <X size={30} aria-hidden />
        </button>
        <button type="button" className="match-btn h-16 w-16 text-white bg-[linear-gradient(135deg,#ff5f8a,#ff8a3d)] border-transparent" aria-label="Save" title="Save (→)" onClick={() => decide("right")} disabled={!top}>
          <Heart size={28} fill="currentColor" aria-hidden />
        </button>
        <button type="button" className="match-btn h-12 w-12 text-cyan" aria-label="Open the event" title="Open (↑)" onClick={() => decide("up")} disabled={!top}>
          <ArrowUpRight size={20} aria-hidden />
        </button>
      </div>

      {savedThisVisit.length > 0 && (
        <div className="mt-8 surface rounded-[var(--radius-l)] p-4 panel-in">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">Your matches <span className="text-text-3 font-normal">({savedThisVisit.length})</span></p>
            <Link href="/my-world?tab=saved" className="t-small text-cyan font-semibold hover:underline">All saved →</Link>
          </div>
          <ul className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
            {savedThisVisit.map((c) => (
              <li key={c.id} className="shrink-0 w-28">
                <Link href={`/events/${c.slug}`} className="block press">
                  <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} className="h-20 w-28 rounded-[var(--radius-s)]" />
                  <p className="t-micro font-semibold mt-1 line-clamp-2">{c.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The top card: follows the finger or mouse, tilts as it goes, and decides past a threshold. */
function SwipeCard({ card: c, fly, onDecide }: { card: EventCard; fly: "left" | "right" | "up" | null; onDecide: (d: "left" | "right" | "up") => void }) {
  const user = useUser();
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const d = formatShortDate(c.start, c.timeZone);
  const dx = fly === "left" ? -700 : fly === "right" ? 700 : drag?.x ?? 0;
  const dy = fly === "up" ? -800 : drag?.y ?? 0;
  const like = Math.max(0, Math.min(1, dx / 120));
  const nope = Math.max(0, Math.min(1, -dx / 120));

  const end = () => {
    const x = drag?.x ?? 0;
    const y = drag?.y ?? 0;
    start.current = null;
    setDrag(null);
    if (x > 110) onDecide("right");
    else if (x < -110) onDecide("left");
    else if (y < -140 && Math.abs(x) < 80) onDecide("up");
  };

  return (
    <article
      className="match-card absolute inset-0 rounded-[28px] overflow-hidden bg-panel shadow-2xl select-none touch-none"
      style={{
        transform: `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`,
        transition: drag ? "none" : "transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        cursor: drag ? "grabbing" : "grab",
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("a, button")) return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDrag({ x: 0, y: 0 });
      }}
      onPointerMove={(e) => start.current && setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y })}
      onPointerUp={end}
      onPointerCancel={() => {
        start.current = null;
        setDrag(null);
      }}
      aria-label={`${c.title}, ${d.weekday} ${d.day} ${d.month}, ${c.venueName}, ${c.city}`}
    >
      <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} size="lg" className="absolute inset-0 h-full w-full pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0)_40%,rgb(5_12_30/0.88)_100%)] pointer-events-none" />
      <span className="match-stamp left-5 border-ok text-ok -rotate-12" style={{ opacity: like }} aria-hidden>SAVE</span>
      <span className="match-stamp right-5 border-bad text-bad rotate-12" style={{ opacity: nope }} aria-hidden>PASS</span>
      <div className="absolute left-4 top-4 flex gap-1.5">
        <span className="rounded-full bg-white/90 px-2.5 py-1 t-micro font-semibold text-text tnum">{d.weekday} {d.day} {d.month}{c.hoursUnknown || c.eventType === "daily_attraction" ? "" : `, ${formatEventTime(c.start, c.timeZone)}`}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
        <p className="flex items-center gap-1.5 t-small text-white/85"><CategoryIcon slug={c.categorySlug} size={14} /> {categoryLabel(c.categorySlug)}</p>
        <h2 className="text-[26px] leading-tight font-bold tracking-[-0.02em] mt-1 line-clamp-3 text-balance">{c.title}</h2>
        <p className="t-small text-white/85 mt-1.5 flex items-center gap-1"><MapPin size={14} aria-hidden /> <span className="truncate">{c.venueName}, {c.city}{c.distanceKm != null ? ` · ${Math.round(c.distanceKm)} km` : ""}</span></p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="rounded-full bg-white/15 backdrop-blur px-3 py-1 t-small font-semibold">
            <Price amount={c.fromPrice?.amount} currency={c.fromPrice?.currency} feesIncluded={c.fromPrice?.feesIncluded} isFree={c.isFree} displayCurrency={user.prefs.currency} />
          </span>
          <Link href={`/events/${c.slug}`} className="t-small font-semibold underline-offset-2 hover:underline">Details →</Link>
        </div>
      </div>
    </article>
  );
}
