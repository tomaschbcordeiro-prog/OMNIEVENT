"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dices, Loader2, Share2, X } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { cardWhen } from "@/lib/format";
import { Poster, SaveButton } from "../ui";
import { toast } from "../toast";
import { datePresets } from "../discover/filters";

/**
 * "Spin the globe": the planet turns like a wheel of fortune, city names roll past, and it
 * lands on one real event somewhere in the world. Pick when (tonight, this weekend, this
 * week) and a vibe, then spin again as often as you like.
 */

const WHEN = [
  { id: "tonight", label: "Tonight" },
  { id: "weekend", label: "This weekend" },
  { id: "week", label: "This week" },
] as const;
type When = (typeof WHEN)[number]["id"];

const VIBES = [
  { id: "any", label: "Anything", emoji: "🎲", groups: [] },
  { id: "music", label: "Music", emoji: "🎶", groups: ["music"] },
  { id: "stage", label: "Stage", emoji: "🎭", groups: ["theatre"] },
  { id: "comedy", label: "Laughs", emoji: "😂", groups: ["comedy"] },
  { id: "party", label: "Party", emoji: "🪩", groups: ["nightlife", "festivals"] },
  { id: "sport", label: "Sport", emoji: "⚽", groups: ["sports"] },
  { id: "art", label: "Art", emoji: "🎨", groups: ["exhibitions"] },
  { id: "food", label: "Food", emoji: "🍷", groups: ["food-drink"] },
] as const;
type Vibe = (typeof VIBES)[number]["id"];

const GROUP_EMOJI: Record<string, string> = {
  music: "🎶", sports: "⚽", theatre: "🎭", comedy: "😂", festivals: "🎉", cinema: "🎬", conferences: "🎤", technology: "💻",
  exhibitions: "🎨", attractions: "🎡", "food-drink": "🍷", nightlife: "🪩", family: "🧸", outdoor: "🥾", education: "📚", fashion: "👗", culture: "🏛️",
};
const emojiOf = (c: EventCard) => GROUP_EMOJI[c.groupSlug] ?? "✨";
const placeOf = (c: EventCard) => c.city || c.country;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The query for a choice of day and vibe (days in the visitor's own calendar). */
export function spinQuery(when: When, vibe: Vibe): string {
  const p = new URLSearchParams({ n: "12" });
  const today = ymd(new Date());
  if (when === "tonight") {
    p.set("from", today);
    p.set("to", today);
    p.set("tfrom", "17:00");
  } else {
    const preset = datePresets().find((x) => x.id === (when === "weekend" ? "weekend" : "week"))!;
    p.set("from", preset.from);
    p.set("to", preset.to);
  }
  const groups = VIBES.find((v) => v.id === vibe)?.groups ?? [];
  if (groups.length) p.set("cat", groups.join(","));
  return p.toString();
}

type Phase = "idle" | "spinning" | "landed" | "empty" | "error";

export function GlobeSpin({
  token,
  ready,
  reduced,
  spin,
  onLand,
  onOpen,
  onClose,
}: {
  /** Changes each time a spin is asked for from outside (the buttons on the page). */
  token: number;
  /** The map is ready to turn. */
  ready: boolean;
  reduced: boolean;
  spin: (lat: number, lng: number) => Promise<boolean>;
  onLand: (c: EventCard) => void;
  onOpen: (c: EventCard) => void;
  onClose: () => void;
}) {
  const [when, setWhen] = useState<When>("week");
  const [vibe, setVibe] = useState<Vibe>("any");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<EventCard | null>(null);
  const [reel, setReel] = useState<{ text: string; n: number }>({ text: "🌍 Shuffling the planet…", n: 0 });
  const [trail, setTrail] = useState<EventCard[]>([]);
  const [burst, setBurst] = useState(0);
  const pool = useRef<{ key: string; items: EventCard[]; at: number }>({ key: "", items: [], at: 0 });
  const reelTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const busy = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /** Rolls place names past, slowing down over about three seconds, like a slot machine. */
  const roll = (names: string[]) => {
    clearTimeout(reelTimer.current);
    if (reduced || !names.length) return;
    const t0 = performance.now();
    let i = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / 3000);
      setReel({ text: names[i++ % names.length], n: i });
      if (k < 1) reelTimer.current = setTimeout(tick, 55 + 420 * k * k);
    };
    tick();
  };
  useEffect(() => () => clearTimeout(reelTimer.current), []);

  const go = useCallback(
    async (w: When = when, v: Vibe = vibe) => {
      if (busy.current) return;
      busy.current = true;
      setPhase("spinning");
      setResult(null);
      setReel({ text: "🌍 Shuffling the planet…", n: 0 });
      try {
        const key = spinQuery(w, v);
        if (pool.current.key !== key || pool.current.at >= pool.current.items.length) {
          const r = await fetch(`/api/spin?${key}`);
          if (!r.ok) throw new Error(String(r.status));
          const j = (await r.json()) as { items: EventCard[] };
          pool.current = { key, items: j.items, at: 0 };
        }
        const { items } = pool.current;
        if (!items.length) {
          setPhase("empty");
          return;
        }
        const pick = items[pool.current.at++];
        // Names from all over the planet roll past; the winner's comes up last.
        const names = [...items.filter((c) => c !== pick), ...items.filter((c) => c !== pick)].map((c) => `${emojiOf(c)} ${placeOf(c)}`);
        roll(names);
        await spin(pick.lat, pick.lng);
        clearTimeout(reelTimer.current);
        setReel({ text: `${emojiOf(pick)} ${placeOf(pick)}`, n: -1 });
        setResult(pick);
        setPhase("landed");
        setBurst((b) => b + 1);
        setTrail((t) => [pick, ...t.filter((x) => x.id !== pick.id)].slice(0, 6));
        onLand(pick);
        requestAnimationFrame(() => cardRef.current?.focus());
      } catch {
        clearTimeout(reelTimer.current);
        setPhase("error");
      } finally {
        busy.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [when, vibe, spin, onLand, reduced],
  );

  // A spin asked for from the page's buttons, once the map can turn.
  const asked = useRef(0);
  useEffect(() => {
    if (!ready || token === asked.current) return;
    asked.current = token;
    void go();
  }, [token, ready, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const share = async (c: EventCard) => {
    const url = `${location.origin}/events/${c.slug}`;
    const text = `🎲 I spun the globe on OMNIEVENT and it picked ${c.title} in ${placeOf(c)}!`;
    try {
      if (navigator.share) await navigator.share({ title: c.title, text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast({ title: "Link copied", emoji: "📋" });
      }
    } catch {
      // the share sheet was closed
    }
  };

  const spinning = phase === "spinning";
  const choose = (w: When, v: Vibe) => {
    setWhen(w);
    setVibe(v);
    if (!spinning) void go(w, v);
  };

  return (
    <section
      aria-label="Spin the globe"
      className="absolute z-30 inset-x-3 bottom-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[400px] lg:left-auto lg:translate-x-0 lg:right-6 lg:bottom-auto lg:top-[calc(var(--header-h)+0.5rem)] lg:w-[360px] surface-float rounded-[var(--radius-l)] panel-slide overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="spin-die text-xl" aria-hidden data-rolling={spinning || undefined}>🎲</span>
        <h2 className="t-h3 flex-1">Spin the globe</h2>
        <button ref={closeRef} type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="px-4">
        <div role="group" aria-label="When" className="flex gap-1 p-1 rounded-full bg-panel-2">
          {WHEN.map((w) => (
            <button key={w.id} type="button" aria-pressed={when === w.id} disabled={spinning} onClick={() => choose(w.id, vibe)} className={`flex-1 rounded-full px-2 py-1.5 text-[12.5px] font-semibold transition-colors ${when === w.id ? "bg-panel text-text shadow-sm" : "text-text-2 hover:text-text"}`}>
              {w.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Vibe" className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
          {VIBES.map((v) => (
            <button key={v.id} type="button" aria-pressed={vibe === v.id} disabled={spinning} onClick={() => choose(when, v.id)} className={`chip press shrink-0 ${vibe === v.id ? "!bg-text !text-on-ink !border-text" : ""}`}>
              <span aria-hidden>{v.emoji}</span> {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative px-4 pb-4 pt-2" aria-live="polite">
        {(phase === "spinning" || phase === "idle") && (
          <div className="grid place-items-center rounded-[var(--radius-m)] bg-gradient-to-br from-violet/15 via-panel-2 to-cyan/15 h-36 sm:h-44">
            <div className="text-center">
              <p key={reel.n} className="spin-reel text-2xl font-bold">{reel.text}</p>
              <p className="t-micro text-text-3 mt-2 flex items-center justify-center gap-1.5">
                <Loader2 size={12} className="animate-spin" aria-hidden /> {ready ? "Spinning…" : "Getting the globe ready…"}
              </p>
            </div>
          </div>
        )}

        {phase === "landed" && result && (
          <div ref={cardRef} tabIndex={-1} className="duel-in outline-none">
            <p className="t-micro font-semibold uppercase tracking-wide text-violet">🎯 The globe picked</p>
            <button type="button" onClick={() => onOpen(result)} className="group relative mt-1.5 block w-full overflow-hidden rounded-[var(--radius-m)] text-left">
              <Poster title={result.title} imageUrl={result.imageUrl} hue={result.posterHue} categorySlug={result.categorySlug} className="aspect-[16/9] w-full transition-transform duration-500 group-hover:scale-[1.03]" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-3 pt-10 text-white">
                <span className="block t-micro font-semibold opacity-90">{emojiOf(result)} {cardWhen(result)}</span>
                <span className="block font-bold leading-tight line-clamp-2 text-lg">{result.title}</span>
                <span className="block t-micro opacity-90 truncate">📍 {result.venueName}{result.city ? `, ${result.city}` : ""}{result.country ? ` · ${result.country}` : ""}</span>
              </span>
              <span className="absolute left-1/2 top-1/3" aria-hidden>
                <span key={burst} className="burst">
                  {Array.from({ length: 16 }, (_, i) => (
                    <i key={i} style={{ ["--c" as string]: ["#ffb800", "#1463ff", "#f0475a", "#0fa979", "#7b4dff"][i % 5], ["--r" as string]: `${(i * 360) / 16}deg`, ["--d" as string]: `${46 + (i % 3) * 18}px` }} />
                  ))}
                </span>
              </span>
              {result.isFree && <span className="absolute right-2 top-2 rounded-full bg-ok px-2 py-0.5 t-micro font-bold text-white">Free</span>}
            </button>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" className="btn btn-primary press flex-1" onClick={() => void go()}>
                <Dices size={16} aria-hidden /> Spin again
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => onOpen(result)}>Open</button>
              <SaveButton id={result.id} title={result.title} compact />
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Share" onClick={() => void share(result)}>
                <Share2 size={15} aria-hidden />
              </button>
            </div>
          </div>
        )}

        {phase === "empty" && (
          <div className="rounded-[var(--radius-m)] border border-dashed border-line-strong p-4 text-center">
            <p className="text-2xl" aria-hidden>🌵</p>
            <p className="font-semibold mt-1">Nothing like that {when === "tonight" ? "tonight" : when === "weekend" ? "this weekend" : "this week"}</p>
            <p className="t-small text-text-2 mt-0.5">Try another vibe or a different day.</p>
            <button type="button" className="btn btn-primary btn-sm mt-3" onClick={() => choose("week", "any")}><Dices size={14} aria-hidden /> Spin for anything</button>
          </div>
        )}

        {phase === "error" && (
          <div className="rounded-[var(--radius-m)] border border-bad/30 bg-bad/5 p-4 text-center">
            <p className="font-semibold">The globe got stuck 😅</p>
            <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => void go()}>Try again</button>
          </div>
        )}

        {trail.length > 1 && (
          <div className="mt-3">
            <p className="t-micro text-text-3">Your spins</p>
            <ul className="mt-1 flex gap-1.5 overflow-x-auto no-scrollbar">
              {trail.slice(1).map((c) => (
                <li key={c.id} className="shrink-0">
                  <button type="button" disabled={spinning} className="chip press max-w-48" onClick={() => onOpen(c)} title={c.title}>
                    <span aria-hidden>{emojiOf(c)}</span> <span className="truncate">{placeOf(c)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
