"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Dices, LocateFixed, MapPin, Plus, Search, Sparkles, X } from "lucide-react";
import { filtersToParams } from "@/lib/search/params";
import { parseInput, planSentence, planToFilters, suggest, WHEN_LABEL, type Plan, type PlaceChip, type When, type WhatChip, type WhenPreset } from "@/lib/match/plan";
import { CategoryIcon } from "../ui";
import { toast } from "../toast";

/**
 * Builds a Match plan from chips. Type a place, a vibe or any word and add it (Enter, comma or
 * the Add button); several at once work too ("Lisboa, Madrid e jazz"). Places are
 * alternatives, vibes and words are alternatives, and the two combine. The number of
 * matching events updates as you go; Go starts the deck.
 */

const RECENT_KEY = "omnievent:match-plans:v1";
const VIBE_IDEAS = ["music", "jazz", "rock-metal", "electronic", "comedy", "theatre", "football", "exhibitions", "nightlife", "family", "food-drink", "outdoor"];
const PLACE_IDEAS = ["lisbon", "porto", "madrid", "barcelona", "paris", "london", "berlin", "new-york"];

type Suggestion = { key: string; kind: "parsed" | "place" | "cat" | "word"; label: string; sub?: string; apply: () => void };

function readRecent(): Plan[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Plan[]).filter((p) => p && Array.isArray(p.places) && Array.isArray(p.what)).slice(0, 4);
  } catch {
    return [];
  }
}
export function rememberPlan(p: Plan) {
  if (!p.places.length && !p.what.length) return;
  try {
    const key = (x: Plan) => JSON.stringify([x.places.map((y) => y.id), x.what.map((y) => y.cat ?? y.text)]);
    const list = [{ ...p, near: undefined }, ...readRecent().filter((x) => key(x) !== key(p))].slice(0, 4);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // private mode
  }
}

export function PlanBuilder({ plan, onChange, onGo, places: popular }: { plan: Plan; onChange: (p: Plan) => void; onGo: () => void; places: PlaceChip[] }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [recent, setRecent] = useState<Plan[]>([]);
  const [pop, setPop] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

  useEffect(() => setRecent(readRecent()), []);

  // ---- adding and removing chips
  const flash = (key: string) => {
    setPop(key);
    window.setTimeout(() => setPop((k) => (k === key ? null : k)), 450);
  };
  const addPlace = (p: PlaceChip) => {
    if (!plan.places.some((x) => x.id === p.id)) onChange({ ...plan, places: [...plan.places, { id: p.id, label: p.label }], near: undefined });
    flash(`p:${p.id}`);
  };
  const addWhat = (w: WhatChip) => {
    const k = w.cat ?? w.text.toLowerCase();
    if (!plan.what.some((x) => (x.cat ?? x.text.toLowerCase()) === k)) onChange({ ...plan, what: [...plan.what, w] });
    flash(`w:${k}`);
  };
  const clear = () => {
    setText("");
    setOpen(false);
    setActive(0);
    input.current?.focus();
  };
  const addTyped = (raw: string) => {
    const t = raw.trim();
    if (!t) return false;
    const p = parseInput(t, tz);
    if (!p.places.length && !p.what.length && !p.when && !p.free && !p.maxPrice) return false;
    const places = [...plan.places];
    for (const x of p.places) if (!places.some((y) => y.id === x.id)) places.push(x);
    const what = [...plan.what];
    for (const x of p.what) if (!what.some((y) => (y.cat ?? y.text.toLowerCase()) === (x.cat ?? x.text.toLowerCase()))) what.push(x);
    onChange({ ...plan, places, what, when: p.when ?? plan.when, free: p.free || plan.free, maxPrice: p.maxPrice ?? plan.maxPrice, near: p.places.length ? undefined : plan.near });
    if (p.when) toast({ title: `When: ${typeof p.when === "object" ? p.when.label : WHEN_LABEL[p.when]}`, emoji: "📅" });
    p.places.forEach((x) => flash(`p:${x.id}`));
    p.what.forEach((x) => flash(`w:${x.cat ?? x.text.toLowerCase()}`));
    return true;
  };

  // ---- suggestions for what's being typed
  const suggestions = useMemo<Suggestion[]>(() => {
    const t = text.trim();
    if (t.length < 2) return [];
    const out: Suggestion[] = [];
    const parsed = parseInput(t, tz);
    const parts = [...parsed.places.map((p) => `📍 ${p.label}`), ...parsed.what.map((w) => (w.cat ? w.label : `“${w.text}”`)), parsed.when ? `📅 ${typeof parsed.when === "object" ? parsed.when.label : WHEN_LABEL[parsed.when]}` : "", parsed.free ? "Free" : ""].filter(Boolean);
    if (parts.length > 1 || (parts.length === 1 && (parsed.when || parsed.free || parsed.maxPrice))) out.push({ key: "parsed", kind: "parsed", label: `Add ${parts.join(" + ")}`, apply: () => addTyped(t) });
    const s = suggest(t);
    for (const p of s.places) out.push({ key: `p:${p.id}`, kind: "place", label: p.label, sub: p.sub, apply: () => addPlace(p) });
    for (const c of s.cats) out.push({ key: `c:${c.cat}`, kind: "cat", label: c.label, sub: "Vibe", apply: () => addWhat(c) });
    if (!parsed.places.length || parsed.what.length) out.push({ key: "word", kind: "word", label: `“${t}”`, sub: "Search this word", apply: () => addWhat({ text: t, label: t }) });
    return out.slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, plan]);

  const pick = (i: number) => {
    const s = suggestions[i];
    if (s) s.apply();
    clear();
  };

  // ---- live count of matching events
  const filters = planToFilters(plan);
  const key = filtersToParams(filters).toString();
  useEffect(() => {
    const ctrl = new AbortController();
    setCounting(true);
    const t = setTimeout(() => {
      fetch(`/api/events?${key}&size=1`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: { total: number }) => {
          setCount(j.total);
          setCounting(false);
        })
        .catch((e) => e.name !== "AbortError" && setCounting(false));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [key]);

  const go = () => {
    if (text.trim()) addTyped(text);
    clear();
    rememberPlan(plan);
    onGo();
  };

  const surprise = () => {
    const place = popular[Math.floor(Math.random() * popular.length)];
    const vibe = VIBE_IDEAS[Math.floor(Math.random() * VIBE_IDEAS.length)];
    const next: Plan = { ...plan, places: place ? [place] : [], what: [{ text: vibe, label: vibeLabel(vibe), cat: vibe }], when: "month", near: undefined };
    onChange(next);
    flash(`p:${place?.id}`);
    flash(`w:${vibe}`);
  };

  const locate = () => {
    if (plan.near) return onChange({ ...plan, near: undefined });
    if (!navigator.geolocation) return toast({ title: "Location isn't available in this browser", emoji: "📍" });
    navigator.geolocation.getCurrentPosition(
      (pos) => onChange({ ...plan, near: { lat: pos.coords.latitude, lng: pos.coords.longitude }, places: [] }),
      () => toast({ title: "We couldn't get your location", body: "Add a place instead.", emoji: "📍" }),
      { maximumAge: 600000, timeout: 10000 },
    );
  };

  const empty = !plan.places.length && !plan.what.length;
  const ideasPlaces = (popular.length ? popular : PLACE_IDEAS.map((id) => ({ id, label: id }))).filter((p) => !plan.places.some((x) => x.id === p.id)).slice(0, 8);
  const ideasVibes = VIBE_IDEAS.filter((v) => !plan.what.some((x) => x.cat === v)).slice(0, 10);

  return (
    <div className="surface rounded-[24px] p-4 sm:p-5 shadow-[0_24px_60px_-30px_rgb(20_50_110_/_0.45)] panel-in">
      <label htmlFor="plan-input" className="t-h3 flex items-center gap-2">
        <Sparkles size={17} className="text-sun" aria-hidden /> What are you in the mood for?
      </label>
      <p className="t-small text-text-2 mt-0.5">Add places, vibes or any word: an artist, a team, “fado”. Places are alternatives, and so are vibes.</p>

      {/* ---- chips + input */}
      <div className="relative mt-3">
        <div
          className="flex flex-wrap items-center gap-1.5 rounded-[16px] border-2 border-line bg-panel px-2.5 py-2 focus-within:border-cyan transition-colors cursor-text"
          onClick={() => input.current?.focus()}
        >
          <Search size={17} className="text-text-3 ml-0.5 shrink-0" aria-hidden />
          {plan.places.map((p) => (
            <Chip key={p.id} tone="place" pop={pop === `p:${p.id}`} label={p.label} icon={<MapPin size={13} aria-hidden />} onRemove={() => onChange({ ...plan, places: plan.places.filter((x) => x.id !== p.id) })} />
          ))}
          {plan.places.length > 1 && <span className="sr-only">(any of these places)</span>}
          {plan.what.map((w) => (
            <Chip
              key={w.cat ?? w.text}
              tone="what"
              pop={pop === `w:${w.cat ?? w.text.toLowerCase()}`}
              label={w.label}
              icon={w.cat ? <CategoryIcon slug={w.cat} size={13} /> : <Search size={12} aria-hidden />}
              onRemove={() => onChange({ ...plan, what: plan.what.filter((x) => x !== w) })}
            />
          ))}
          {plan.near && <Chip tone="place" label="Near me" icon={<LocateFixed size={13} aria-hidden />} onRemove={() => onChange({ ...plan, near: undefined })} />}
          {plan.free && <Chip tone="free" label="Free" icon={<span aria-hidden>🆓</span>} onRemove={() => onChange({ ...plan, free: undefined })} />}
          {plan.maxPrice && <Chip tone="free" label={`Under ${plan.maxPrice.amount}${plan.maxPrice.currency ? ` ${plan.maxPrice.currency}` : ""}`} icon={<span aria-hidden>💶</span>} onRemove={() => onChange({ ...plan, maxPrice: undefined })} />}
          <input
            ref={input}
            id="plan-input"
            value={text}
            autoComplete="off"
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls="plan-suggestions"
            aria-activedescendant={open && suggestions[active] ? `plan-s-${active}` : undefined}
            placeholder={empty ? "Try Lisboa, jazz, comedy, Madrid…" : "Add another…"}
            className="flex-1 min-w-[9rem] bg-transparent outline-none text-[16px] py-1.5 px-1"
            onChange={(e) => {
              const v = e.target.value;
              // A comma adds what's before it straight away.
              if (/[,;]\s*$/.test(v) && v.replace(/[,;]\s*$/, "").trim()) {
                if (addTyped(v.replace(/[,;]\s*$/, ""))) return clear();
              }
              setText(v);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(suggestions.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (!text.trim()) return go();
                if (open && suggestions.length) pick(active);
                else if (addTyped(text)) clear();
              } else if (e.key === "Escape") setOpen(false);
              else if (e.key === "Backspace" && !text) {
                if (plan.what.length) onChange({ ...plan, what: plan.what.slice(0, -1) });
                else if (plan.places.length) onChange({ ...plan, places: plan.places.slice(0, -1) });
              }
            }}
          />
          {text.trim() && (
            <button
              type="button"
              className="btn btn-primary btn-sm shrink-0"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (suggestions.length ? pick(0) : addTyped(text) && clear())}
            >
              <Plus size={15} aria-hidden /> Add
            </button>
          )}
        </div>
        {open && suggestions.length > 0 && (
          <ul id="plan-suggestions" role="listbox" className="absolute z-30 left-0 right-0 mt-1.5 surface-float rounded-[14px] p-1.5 max-h-[320px] overflow-auto scroll-thin">
            {suggestions.map((s, i) => (
              <li key={s.key} id={`plan-s-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={`w-full flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left ${i === active ? "bg-cyan/10" : ""}`}
                >
                  <span className={`grid place-items-center h-7 w-7 rounded-full shrink-0 ${s.kind === "place" ? "bg-cyan/12 text-cyan" : s.kind === "cat" ? "bg-violet/12 text-violet" : "bg-sun/20 text-text"}`}>
                    {s.kind === "place" ? <MapPin size={14} aria-hidden /> : s.kind === "cat" ? <Sparkles size={14} aria-hidden /> : s.kind === "parsed" ? <Plus size={14} aria-hidden /> : <Search size={13} aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold truncate">{s.label}</span>
                    {s.sub && <span className="block t-micro text-text-3 truncate">{s.sub}</span>}
                  </span>
                  {i === active && <kbd className="t-micro text-text-3 hidden sm:inline">Enter</kbd>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- what it means, and how many */}
      <div className="mt-3 flex items-start justify-between gap-3">
        <p className="t-small text-text-2 min-w-0">
          <span className="font-semibold text-text">{planSentence(plan)}</span>
        </p>
        <p className="t-small tnum shrink-0 text-right" aria-live="polite">
          {counting && count === null ? <span className="text-text-3">Counting…</span> : <><span className={`font-bold ${count === 0 ? "text-bad" : "text-text"}`}>{(count ?? 0).toLocaleString()}</span> <span className="text-text-3">events</span></>}
        </p>
      </div>

      {/* ---- when */}
      <div className="mt-3 flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" role="radiogroup" aria-label="When">
        {(Object.keys(WHEN_LABEL) as WhenPreset[]).map((w) => (
          <button key={w} type="button" role="radio" aria-checked={plan.when === w} onClick={() => onChange({ ...plan, when: w })} className={`chip press shrink-0 ${plan.when === w ? "bg-text text-white border-text" : ""}`}>
            {WHEN_LABEL[w]}
          </button>
        ))}
        {typeof plan.when === "object" && (
          <button type="button" role="radio" aria-checked className="chip press shrink-0 bg-text text-white border-text" onClick={() => onChange({ ...plan, when: "month" })}>
            {plan.when.label} <X size={12} aria-hidden />
          </button>
        )}
        <button type="button" aria-pressed={!!plan.free} onClick={() => onChange({ ...plan, free: plan.free ? undefined : true })} className={`chip press shrink-0 ${plan.free ? "bg-ok text-white border-ok" : ""}`}>
          🆓 Free
        </button>
        <button type="button" aria-pressed={!!plan.near} onClick={locate} className={`chip press shrink-0 ${plan.near ? "bg-cyan text-white border-cyan" : ""}`}>
          <LocateFixed size={14} aria-hidden /> Near me
        </button>
      </div>

      {/* ---- ideas */}
      <div className="mt-4 grid gap-2">
        <IdeaRow label="Places">
          {ideasPlaces.map((p) => (
            <button key={p.id} type="button" className="chip press shrink-0" onClick={() => addPlace(p)}>
              <MapPin size={13} className="text-cyan" aria-hidden /> {p.label}
            </button>
          ))}
        </IdeaRow>
        <IdeaRow label="Vibes">
          {ideasVibes.map((v) => (
            <button key={v} type="button" className="chip press shrink-0" onClick={() => addWhat({ text: v, label: vibeLabel(v), cat: v })}>
              <CategoryIcon slug={v} size={13} /> {vibeLabel(v)}
            </button>
          ))}
        </IdeaRow>
        {recent.length > 0 && (
          <IdeaRow label="Recent">
            {recent.map((r, i) => (
              <button key={i} type="button" className="chip press shrink-0" onClick={() => onChange({ ...r, when: plan.when })}>
                ↺ {[...r.what.map((w) => w.label), ...r.places.map((p) => p.label)].join(" · ")}
              </button>
            ))}
          </IdeaRow>
        )}
      </div>

      {/* ---- go */}
      {/* The main action comes first on phones, full width; the others sit beside it on wider screens. */}
      <div className="mt-5 flex flex-wrap sm:flex-nowrap items-center gap-2">
        <button type="button" className="btn btn-secondary order-2 sm:order-none" onClick={surprise} title="A random place and vibe">
          <Dices size={16} aria-hidden /> Surprise me
        </button>
        {!empty && (
          <button type="button" className="btn btn-ghost order-3 sm:order-none" onClick={() => onChange({ ...plan, places: [], what: [], free: undefined, maxPrice: undefined, near: undefined })}>
            Clear
          </button>
        )}
        <button type="button" className="btn btn-primary order-1 sm:order-none w-full sm:w-auto sm:flex-1 justify-center h-11 text-[15px]" onClick={go} disabled={count === 0}>
          {count === 0 ? "Nothing matches yet" : <>Start swiping{count ? <span className="tnum font-medium">({count.toLocaleString()})</span> : null} <ArrowRight size={17} aria-hidden /></>}
        </button>
      </div>
      {count === 0 && (
        <p className="t-small text-text-2 mt-2">
          Try{" "}
          {plan.when !== "any" && <button type="button" className="text-cyan font-semibold hover:underline" onClick={() => onChange({ ...plan, when: "any" })}>any time</button>}
          {plan.when !== "any" && (plan.what.length > 0 || plan.places.length > 0) ? ", or " : ""}
          {plan.what.length > 0 ? <button type="button" className="text-cyan font-semibold hover:underline" onClick={() => onChange({ ...plan, what: plan.what.slice(0, -1) })}>removing “{plan.what[plan.what.length - 1].label}”</button> : plan.places.length > 0 ? <button type="button" className="text-cyan font-semibold hover:underline" onClick={() => onChange({ ...plan, places: plan.places.slice(0, -1) })}>removing {plan.places[plan.places.length - 1].label}</button> : null}
          .
        </p>
      )}
    </div>
  );
}

const VIBE_NAMES: Record<string, string> = { music: "Music", jazz: "Jazz", "rock-metal": "Rock", electronic: "Electronic", comedy: "Comedy", theatre: "Theatre", football: "Football", exhibitions: "Exhibitions", nightlife: "Nightlife", family: "Family", "food-drink": "Food & drink", outdoor: "Outdoor" };
const vibeLabel = (v: string) => VIBE_NAMES[v] ?? v;

function IdeaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="t-micro text-text-3 w-14 shrink-0">{label}</span>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar min-w-0 py-0.5">{children}</div>
    </div>
  );
}

function Chip({ label, icon, tone, pop, onRemove }: { label: string; icon: React.ReactNode; tone: "place" | "what" | "free"; pop?: boolean; onRemove: () => void }) {
  const cls = tone === "place" ? "bg-cyan/12 text-cyan border-cyan/30" : tone === "what" ? "bg-violet/12 text-violet border-violet/30" : "bg-ok/12 text-ok border-ok/30";
  return (
    <span className={`inline-flex items-center gap-1.5 h-8 rounded-full border pl-2.5 pr-1 text-[13.5px] font-semibold ${cls} ${pop ? "chip-pop" : ""}`}>
      {icon}
      <span className="max-w-[12rem] truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        className="grid place-items-center h-6 w-6 rounded-full hover:bg-text/10"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <X size={13} aria-hidden />
      </button>
    </span>
  );
}

export type { When };
