"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Heart, MapPin, Pencil, RotateCcw, Sparkles, X } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { cardWhen } from "@/lib/format";
import { filtersToParams } from "@/lib/search/params";
import { EMPTY_PLAN, planFromParams, planSentence, planToFilters, planToParams, type Plan, type PlaceChip } from "@/lib/match/plan";
import { PlanBuilder } from "./plan-builder";
import { userActions, useUser } from "@/lib/user/store";
import { CategoryIcon, Poster, Price, categoryLabel } from "../ui";

/**
 * Event Match: first say what you're in the mood for (places, vibes, any word), then swipe
 * one event at a time. Right (or ♥) saves it to My World, left passes, up opens it. Cards
 * already seen this week are skipped, so every visit shows something new. Works with touch,
 * mouse and the arrow keys. The plan lives in the address, so it can be shared.
 */

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

export function MatchDeck() {
  const user = useUser();
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN);
  const [stage, setStage] = useState<"build" | "swipe">("build");
  const [popular, setPopular] = useState<PlaceChip[]>([]);
  const [deck, setDeck] = useState<EventCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<{ card: EventCard; saved: boolean }[]>([]);
  const [fly, setFly] = useState<{ id: string; dir: "left" | "right" | "up" } | null>(null);
  const seen = useRef<Record<string, number>>({});
  const savedIds = useMemo(() => new Set(user.saved.map((s) => s.id)), [user.saved]);
  const savedThisVisit = history.filter((h) => h.saved).map((h) => h.card);

  useEffect(() => {
    seen.current = readSeen();
    const q = new URLSearchParams(window.location.search);
    setPlan(planFromParams(q));
    if (q.get("go") === "1") setStage("swipe");
    // The busiest cities, as quick ideas.
    fetch("/api/destinations")
      .then((r) => r.json())
      .then((j: { destinations: { id: string; name: string; kind: string; stats?: { total: number } }[] }) =>
        setPopular(j.destinations.filter((d) => d.kind === "city" && (d.stats?.total ?? 0) > 0).sort((a, b) => (b.stats?.total ?? 0) - (a.stats?.total ?? 0)).slice(0, 10).map((d) => ({ id: d.id, label: d.name }))),
      )
      .catch(() => {});
  }, []);

  // The plan and the stage in the address (shareable; back works from the deck).
  useEffect(() => {
    const q = planToParams(plan);
    if (stage === "swipe") q.set("go", "1");
    const next = `/match${q.toString() ? `?${q}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      try {
        window.history.replaceState(window.history.state, "", next);
      } catch {
        // rate limited: the address is a convenience
      }
    }
  }, [plan, stage]);

  const filterKey = filtersToParams({ ...planToFilters(plan), page: undefined }).toString();

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
    try {
      // Skip pages where everything was seen already, a few at a time.
      for (let tries = 0; tries < 4; tries++) {
        const page = nextPage.current++;
        const p = new URLSearchParams(filterKey);
        p.set("size", "40");
        p.set("page", String(page));
        p.set("sort", "relevance");
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
  }, [filterKey, savedIds]);

  useEffect(() => {
    gen.current++;
    nextPage.current = 1;
    fetching.current = false;
    finished.current = false;
    setDeck([]);
  }, [filterKey]);

  useEffect(() => {
    if (stage === "swipe" && deck.length <= 4) void load();
  }, [deck.length, load, stage]);

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
      if (stage !== "swipe" || (e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") decide("right");
      else if (e.key === "ArrowLeft") decide("left");
      else if (e.key === "ArrowUp") decide("up");
      else if (e.key === "Backspace") undo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (stage === "build")
    return (
      <div className="mx-auto max-w-[620px] px-4 pt-6 pb-10">
        <div className="text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-sun/15 px-3 py-1 t-small font-semibold"><Sparkles size={14} className="text-sun" aria-hidden /> Event Match</p>
          <h1 className="t-h1 mt-3">Swipe your next plan</h1>
          <p className="t-body text-text-2 mt-2">Tell us what you fancy, then swipe: right to save, left to pass, up to open.</p>
        </div>
        <div className="mt-5">
          <PlanBuilder plan={plan} onChange={setPlan} onGo={() => setStage("swipe")} places={popular} />
        </div>
      </div>
    );

  return (
    <div className="mx-auto max-w-[520px] px-4 pt-6 pb-10">
      <div className="text-center">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-sun/15 px-3 py-1 t-small font-semibold"><Sparkles size={14} className="text-sun" aria-hidden /> Event Match</p>
        <h1 className="t-h1 mt-3">Swipe your next plan</h1>
        <p className="t-small text-text-2 mt-1">Right to save it, left to pass, up to open. Arrow keys work too.</p>
      </div>

      <button type="button" onClick={() => setStage("build")} className="press mt-5 w-full flex items-center gap-3 surface rounded-[16px] px-4 py-3 text-left hover:border-cyan/50 transition-colors" title="Change what you're looking for">
        <span className="min-w-0 flex-1">
          <span className="block t-micro text-text-3">Your plan</span>
          <span className="block font-semibold truncate">{planSentence(plan)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 t-small font-semibold text-cyan shrink-0"><Pencil size={14} aria-hidden /> Edit</span>
      </button>

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
                <p className="t-small text-text-2 mt-1">Widen the plan: other dates, more places or another vibe.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setStage("build")}><Pencil size={14} aria-hidden /> Change the plan</button>
                  {plan.when !== "any" && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPlan({ ...plan, when: "any" })}>Any time</button>}
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
      aria-label={`${c.title}, ${cardWhen(c)}, ${c.venueName}, ${c.city}`}
    >
      <Poster priority title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} size="lg" className="absolute inset-0 h-full w-full pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0)_40%,rgb(5_12_30/0.88)_100%)] pointer-events-none" />
      <span className="match-stamp left-5 border-ok text-ok -rotate-12" style={{ opacity: like }} aria-hidden>SAVE</span>
      <span className="match-stamp right-5 border-bad text-bad rotate-12" style={{ opacity: nope }} aria-hidden>PASS</span>
      <div className="absolute left-4 top-4 flex gap-1.5">
        <span className="rounded-full bg-white/90 px-2.5 py-1 t-micro font-semibold text-text tnum">{cardWhen(c)}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
        <p className="flex items-center gap-1.5 t-small text-white/85"><CategoryIcon slug={c.categorySlug} size={14} /> {categoryLabel(c.categorySlug)}</p>
        <h2 className="text-[26px] leading-tight font-bold tracking-[-0.02em] mt-1 line-clamp-3 text-balance">{c.title}</h2>
        <p className="t-small text-white/85 mt-1.5 flex items-center gap-1"><MapPin size={14} aria-hidden /> <span className="truncate">{c.venueName}, {c.city}{c.distanceKm != null ? ` · ${Math.round(c.distanceKm)} km` : ""}</span></p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="rounded-full bg-white/90 text-text px-3 py-1 t-small font-semibold">
            <Price amount={c.fromPrice?.amount} currency={c.fromPrice?.currency} feesIncluded={c.fromPrice?.feesIncluded} isFree={c.isFree} displayCurrency={user.prefs.currency} />
          </span>
          <Link href={`/events/${c.slug}`} className="t-small font-semibold underline-offset-2 hover:underline">Details →</Link>
        </div>
      </div>
    </article>
  );
}
