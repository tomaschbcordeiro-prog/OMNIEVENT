"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Clock, ExternalLink, ImageIcon, Loader2, MapPin, Minus, Pencil, Plus, Share2, Sparkles, Ticket, Trash2, X } from "lucide-react";
import { GROUPS, GROUP_HEX, childrenOf, getCategory } from "@/lib/categories";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { ACCESS_KINDS, ACCESSIBILITY_OPTIONS, AGE_OPTIONS, LIMITS, cleanUrl } from "@/lib/user-events-shared";
import { myEventsGet, myEventsPost, useMe } from "@/lib/community/client";
import { Burst, requireMember } from "../community/bits";
import { CategoryIcon, Poster } from "../ui";
import { toast } from "../toast";
import { Field, Segmented, TagInput, Toggle } from "./fields";
import { LocationPicker } from "./location-picker";
import { STEPS, applyExtracted, applyTemplate, currencyFor, emptyDraft, firstProblem, fromInput, posterDataOf, problems, toInput, todayLocal, type Draft, type StepId } from "./draft";
import { POSTER_STYLES } from "@/lib/studio/poster";
import { getTemplate } from "@/lib/studio/templates";
import type { Extracted } from "@/lib/studio/magic";
import { ScaledPoster } from "../studio/scaled-poster";
import { PASTE_KEY } from "@/lib/studio/keys";

const DRAFT_KEY = "omni:create-event:v1";

/** Starting ideas for genres and styles, by kind of event. */
const GENRE_IDEAS: Record<string, string[]> = {
  music: ["Jazz", "Rock", "Indie", "Electronic", "Pop", "Classical", "Fado", "Hip-hop", "Folk", "Latin", "Metal", "Acoustic"],
  nightlife: ["House", "Techno", "Disco", "Reggaeton", "Rooftop", "Beach party", "Drag", "Karaoke"],
  theatre: ["Drama", "Musical", "Dance", "Ballet", "Improv", "Physical theatre", "Opera"],
  comedy: ["Stand-up", "Improv", "Open mic", "Sketch", "Roast"],
  sports: ["Football", "Running", "Padel", "Basketball", "Surf", "Cycling", "Tournament"],
  festivals: ["Street festival", "Cultural", "Food", "Arts", "Pride", "Seasonal"],
  cinema: ["Outdoor screening", "Documentary", "Short films", "Classics", "Premiere"],
  exhibitions: ["Photography", "Contemporary art", "Design", "Illustration", "Open studio"],
  "food-drink": ["Wine tasting", "Street food", "Supper club", "Craft beer", "Cooking class", "Brunch"],
  family: ["Kids' theatre", "Workshop", "Storytelling", "Outdoor play", "Puppets"],
  outdoor: ["Hike", "Guided tour", "Stargazing", "Kayak", "Nature walk", "Yoga"],
  education: ["Workshop", "Talk", "Masterclass", "Language exchange", "Book club"],
  conferences: ["Meetup", "Networking", "Panel", "Summit", "Pitch night"],
  technology: ["Hackathon", "AI", "Startup", "Web", "Meetup"],
};
const LANGUAGE_IDEAS = ["English", "Portuguese", "Spanish", "French", "German", "Italian"];
const HUES = [345, 15, 35, 50, 140, 170, 195, 215, 240, 265, 290, 320];

const localDay = (date: string, opts: Intl.DateTimeFormatOptions) => (date ? new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", opts) : "");
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "Sat 14 Dec, 21:30 to 23:30" and the like, from the answers. */
function whenLine(d: Draft): string {
  if (!d.date) return "Date to be set";
  const first = localDay(d.date, { weekday: "short", day: "numeric", month: "short", year: d.date.slice(0, 4) !== String(new Date().getFullYear()) ? "numeric" : undefined });
  const time = d.time ? `, ${d.time}${d.endTime ? ` to ${d.endTime}` : ""}` : "";
  if (d.multiDay && d.endDate) return `${first} to ${localDay(d.endDate, { weekday: "short", day: "numeric", month: "short" })}${time}`;
  if (d.repeat === "weekly") return `${first}${time}, then weekly for ${d.weeks} weeks`;
  if (d.repeat === "dates" && d.dates.length) return `${first}${time}, plus ${d.dates.length} more ${d.dates.length === 1 ? "date" : "dates"}`;
  return `${first}${time}`;
}

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "EUR", maximumFractionDigits: n % 1 ? 2 : 0, minimumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch {
    return String(n);
  }
}

function priceLine(d: Draft): string {
  if (d.access === "free") return "Free";
  if (d.access === "registration") return d.soldOut ? "Fully booked" : "Free, sign up first";
  const prices = d.tiers.map((t) => Number(t.price.replace(",", "."))).filter((n) => d.tiers.length && Number.isFinite(n) && n >= 0);
  if (d.access === "ticketed" && prices.length) {
    if (d.soldOut) return "Sold out";
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    return lo === hi ? money(lo, d.currency) : `${money(lo, d.currency)} to ${money(hi, d.currency)}`;
  }
  return "Tickets to be set";
}

export function CreateEvent({ editId, template, fromPaste, duplicateId }: { editId?: string; template?: string; fromPaste?: boolean; duplicateId?: string }) {
  const router = useRouter();
  const { profile } = useMe();
  const [d, setD] = useState<Draft>(emptyDraft);
  const [at, setAt] = useState(0);
  const [reached, setReached] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [done, setDone] = useState<{ slug: string; id: string; updated: boolean } | null>(null);
  const [restored, setRestored] = useState(false);
  /** How this draft started: a template, a pasted announcement or a copy, shown as a banner. */
  const [origin, setOrigin] = useState<{ kind: "template" | "paste" | "copy"; text: string } | null>(null);
  const [loading, setLoading] = useState(!!editId);
  const [editState, setEditState] = useState<{ cancelled?: boolean; slug?: string }>({});
  const [tz, setTz] = useState<{ timeZone: string; label: string } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = STEPS[at];
  const errs = showErrors ? problems(step.id, d) : {};
  const set = useCallback(<K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v })), []);
  const setVenue = (patch: Partial<Draft["venue"]>) => setD((x) => ({ ...x, venue: { ...x.venue, ...patch } }));

  // A head start: a template, a pasted announcement, or a copy of one of your events.
  const prefilled = !!(template || fromPaste || duplicateId);
  useEffect(() => {
    if (editId) return;
    const tpl = getTemplate(template);
    if (tpl) {
      setD((x) => applyTemplate(x, tpl));
      setOrigin({ kind: "template", text: `${tpl.emoji} Started from “${tpl.name}”: times, tickets, a programme and a description to adapt are filled in.` });
      return;
    }
    if (fromPaste) {
      try {
        const x = JSON.parse(localStorage.getItem(PASTE_KEY) ?? "null") as Extracted | null;
        if (x) {
          setD((dd) => applyExtracted(dd, x));
          setOrigin({ kind: "paste", text: `✨ Filled from your text: ${x.found.join(", ") || "a few details"}. Check each step before publishing.` });
        }
        localStorage.removeItem(PASTE_KEY);
      } catch {
        // storage unavailable
      }
      return;
    }
    if (duplicateId) {
      setLoading(true);
      myEventsGet<{ event: Parameters<typeof fromInput>[0] }>(`id=${encodeURIComponent(duplicateId)}`)
        .then(({ event }) => {
          setD({ ...fromInput(event), date: "", endDate: "", dates: [] });
          setOrigin({ kind: "copy", text: `📋 A copy of “${event.title}”. Choose the new date, change anything else, and publish.` });
          setReached(STEPS.length - 1);
          setAt(STEPS.findIndex((s) => s.id === "when"));
        })
        .catch((err) => setServerError(err instanceof Error ? err.message : "Couldn't copy that event."))
        .finally(() => setLoading(false));
    }
  }, [editId, template, fromPaste, duplicateId]);

  // A draft from last time comes back (new listings without a head start only).
  useEffect(() => {
    if (editId || prefilled) return;
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as { draft: Draft; at: number; reached: number } | null;
      if (saved?.draft && (saved.draft.title || saved.draft.venue.name || saved.draft.description)) {
        setD({ ...emptyDraft(), ...saved.draft, agree: false });
        setAt(Math.min(saved.at ?? 0, STEPS.length - 1));
        setReached(Math.min(saved.reached ?? 0, STEPS.length - 1));
        setRestored(true);
      }
    } catch {
      // storage unavailable: start fresh
    }
  }, [editId, prefilled]);
  useEffect(() => {
    if (editId || done) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft: d, at, reached }));
      } catch {
        // storage unavailable
      }
    }, 400);
    return () => clearTimeout(t);
  }, [d, at, reached, editId, done]);

  // Editing: the owner's saved answers.
  useEffect(() => {
    if (!editId) return;
    myEventsGet<{ event: Parameters<typeof fromInput>[0] & { slug: string; cancelled?: boolean } }>(`id=${encodeURIComponent(editId)}`)
      .then(({ event }) => {
        setD(fromInput(event));
        setEditState({ cancelled: event.cancelled, slug: event.slug });
        setReached(STEPS.length - 1);
      })
      .catch((err) => setServerError(err instanceof Error ? err.message : "Couldn't open this event."))
      .finally(() => setLoading(false));
  }, [editId]);

  // The organiser defaults to the member's name.
  useEffect(() => {
    if (profile?.name && !d.organiserName) set("organiserName", profile.name);
  }, [profile?.name, d.organiserName, set]);

  // The venue's time zone, to show whose clock the times are on.
  useEffect(() => {
    const { lat, lng } = d.venue;
    if (lat == null || lng == null) return setTz(null);
    const ctrl = new AbortController();
    fetch(`/api/timezone?lat=${lat}&lng=${lng}${d.date ? `&date=${d.date}` : ""}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setTz({ timeZone: j.timeZone, label: j.label }))
      .catch(() => {});
    return () => ctrl.abort();
  }, [d.venue.lat, d.venue.lng, d.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (i: number) => {
    setAt(i);
    setReached((r) => Math.max(r, i));
    setShowErrors(false);
    setServerError("");
    requestAnimationFrame(() => {
      card.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      card.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    });
  };
  const next = () => {
    if (Object.keys(problems(step.id, d)).length) {
      setShowErrors(true);
      requestAnimationFrame(() => card.current?.querySelector<HTMLElement>("[role=alert]")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    go(Math.min(STEPS.length - 1, at + 1));
  };

  const publish = async () => {
    const bad = firstProblem(d);
    if (bad) {
      go(STEPS.findIndex((s) => s.id === bad));
      setShowErrors(true);
      return;
    }
    if (!(await requireMember(!!profile))) return;
    setBusy(true);
    setServerError("");
    try {
      const r = editId
        ? await myEventsPost<{ id: string; slug: string }>({ action: "update", id: editId, event: toInput(d) })
        : await myEventsPost<{ id: string; slug: string }>({ action: "create", event: toInput(d) });
      try {
        if (!editId) localStorage.removeItem(DRAFT_KEY);
      } catch {
        // storage unavailable
      }
      setDone({ ...r, updated: !!editId });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Couldn't publish. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const ownerAction = async (action: "cancel" | "restore" | "delete") => {
    if (!editId) return;
    if (action === "delete" && !window.confirm("Remove this event from OMNIEVENT? This can't be undone.")) return;
    if (action === "cancel" && !window.confirm("Mark this event as cancelled? It stays listed with a clear “Cancelled” label.")) return;
    setBusy(true);
    try {
      await myEventsPost({ action, id: editId });
      if (action === "delete") {
        toast({ title: "Event removed", emoji: "🗑️" });
        router.push("/studio");
        return;
      }
      setEditState((s) => ({ ...s, cancelled: action === "cancel" }));
      toast({ title: action === "cancel" ? "Marked as cancelled" : "Back on", emoji: action === "cancel" ? "🚫" : "✅" });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setD({ ...emptyDraft(), organiserName: profile?.name ?? "" });
    setAt(0);
    setReached(0);
    setRestored(false);
    setShowErrors(false);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // storage unavailable
    }
  };

  const okSteps = useMemo(() => new Set(STEPS.filter((s) => !Object.keys(problems(s.id, d)).length).map((s) => s.id)), [d]);

  if (done) return <Done d={d} slug={done.slug} updated={done.updated} onAnother={() => (setDone(null), startOver())} />;

  return (
    <main id="main" className="pb-16">
      <section className="studio-stage">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 pt-6 pb-7 sm:pt-8">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 t-small text-white/70">
            <Link href="/studio" className="studio-mark hover:text-white">Studio</Link>
            <span aria-hidden>/</span>
            <span className="text-white">{editId ? "Edit event" : "New event"}</span>
          </nav>
          <h1 className="t-h1 mt-3 text-white text-balance">{editId ? "Make it right" : <>Put your event <span className="studio-text">on the map</span></>}</h1>
          <p className="t-body text-white/80 mt-2 measure">
            {editId ? "Change anything below; it updates for everyone within a minute." : "Seven short steps. It appears on the globe, in search and on its city's page for everyone."}
          </p>
          <ol className="mt-6 flex gap-1.5 sm:gap-2" aria-label="Steps">
            {STEPS.map((s, i) => {
              const done = i < at || (i <= reached && okSteps.has(s.id) && i !== at);
              const can = i <= reached;
              return (
                <li key={s.id} className="flex-1 min-w-0">
                  <button
                    type="button"
                    disabled={!can}
                    onClick={() => can && go(i)}
                    aria-current={i === at ? "step" : undefined}
                    className={`ce-step group w-full text-left ${i === at ? "ce-step--on" : done ? "ce-step--done" : ""}`}
                  >
                    <span className="ce-step-bar" aria-hidden />
                    <span className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold">
                      <span className="ce-step-dot" aria-hidden>{done && i !== at ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
                      <span className="truncate max-md:sr-only">{s.label}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div ref={card} className="scroll-mt-24">
          {origin && (
            <div className="mb-4 flex items-start gap-3 rounded-[var(--radius-m)] border border-[var(--studio)]/30 bg-[var(--studio)]/[0.06] px-4 py-3 t-small panel-in" role="status">
              <span className="flex-1">{origin.text}</span>
              <button type="button" className="text-text-3 hover:text-text" aria-label="Dismiss" onClick={() => setOrigin(null)}><X size={15} aria-hidden /></button>
            </div>
          )}
          {restored && at === 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-m)] border border-cyan/30 bg-cyan/5 px-4 py-2.5 t-small panel-in">
              <span>We kept your draft from last time.</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={startOver}>Start fresh</button>
            </div>
          )}
          <section
            className="surface rounded-[var(--radius-l)] p-5 sm:p-7"
            aria-labelledby="ce-step-h"
            onKeyDown={(e) => {
              const t = e.target as HTMLElement;
              if (e.key !== "Enter" || e.defaultPrevented || e.shiftKey || t.tagName !== "INPUT" || t.closest("[data-own-enter]")) return;
              if (["checkbox", "radio", "button"].includes((t as HTMLInputElement).type)) return;
              e.preventDefault();
              if (step.id === "publish") void publish();
              else next();
            }}
          >
            {loading ? (
              <div className="grid gap-3" aria-hidden>
                <div className="skeleton h-8 w-2/3" />
                <div className="skeleton h-40" />
              </div>
            ) : (
              <>
                <p className="t-micro font-bold uppercase tracking-[0.14em] text-[#b77900]">Step {at + 1} of {STEPS.length}</p>
                <h2 id="ce-step-h" tabIndex={-1} className="t-h2 mt-1 outline-none">{step.title}</h2>
                <p className="t-small text-text-2 mt-1">{step.lede}</p>
                <div key={step.id} className="mt-6 grid gap-6 content-swap">
                  {step.id === "basics" && <Basics d={d} set={set} errs={errs} />}
                  {step.id === "place" && <Place d={d} setVenue={setVenue} errs={errs} tz={tz} setCurrency={(c) => !d.currency && c && set("currency", c)} />}
                  {step.id === "when" && <When d={d} set={set} errs={errs} tz={tz} />}
                  {step.id === "tickets" && <Tickets d={d} set={set} errs={errs} />}
                  {step.id === "details" && <Details d={d} set={set} errs={errs} />}
                  {step.id === "look" && <Look d={d} set={set} errs={errs} />}
                  {step.id === "publish" && <Publish d={d} set={set} errs={errs} go={go} signedIn={!!profile?.username} editing={!!editId} />}
                </div>
                {serverError && (
                  <p role="alert" className="mt-5 rounded-[var(--radius-m)] border border-bad/30 bg-bad/5 p-3 t-small text-text">{serverError}</p>
                )}
                {showErrors && Object.keys(errs).length > 0 && (
                  <p className="mt-5 t-small text-bad">A few things above need a look before you go on.</p>
                )}
                <div className="mt-7 flex flex-wrap items-center gap-2 border-t border-line pt-5">
                  {at > 0 && (
                    <button type="button" className="btn btn-ghost" onClick={() => go(at - 1)}>
                      <ArrowLeft size={16} aria-hidden /> Back
                    </button>
                  )}
                  <span className="flex-1" />
                  {!editId && <span className="t-micro text-text-3 max-sm:hidden">Draft saved on this device</span>}
                  {step.id !== "publish" ? (
                    <button type="button" className="btn btn-primary press" onClick={next}>
                      Continue <ArrowRight size={16} aria-hidden />
                    </button>
                  ) : (
                    <button type="button" className="btn btn-gold press !h-12 px-6 text-[15px]" onClick={() => void publish()} disabled={busy}>
                      {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Sparkles size={17} aria-hidden />}
                      {editId ? "Save changes" : "Publish event"}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
          {editId && !loading && (
            <section className="mt-4 rounded-[var(--radius-l)] border border-line p-4 sm:p-5" aria-label="Manage this event">
              <p className="font-semibold">Manage this event</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {editState.slug && <Link href={`/events/${editState.slug}`} className="btn btn-secondary btn-sm">View event</Link>}
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void ownerAction(editState.cancelled ? "restore" : "cancel")}>
                  {editState.cancelled ? "It's back on" : "Mark as cancelled"}
                </button>
                <button type="button" className="btn btn-ghost btn-sm text-bad" disabled={busy} onClick={() => void ownerAction("delete")}>
                  <Trash2 size={14} aria-hidden /> Remove listing
                </button>
              </div>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-[calc(var(--header-h)+1rem)] grid gap-3" aria-label="Preview">
          <p className="t-micro font-bold uppercase tracking-[0.14em] text-text-3">Live preview</p>
          <PreviewCard d={d} />
          <ul className="surface rounded-[var(--radius-l)] p-3 grid gap-0.5" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <button type="button" disabled={i > reached} onClick={() => go(i)} className={`flex w-full items-center gap-2.5 rounded-[var(--radius-s)] px-2 py-1.5 text-left t-small ${i === at ? "bg-text/[0.06] font-semibold" : "hover:bg-text/[0.04] disabled:opacity-50 disabled:hover:bg-transparent"}`}>
                  <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${okSteps.has(s.id) && i <= reached ? "bg-ok text-on-ink" : "bg-text/10 text-text-2"}`} aria-hidden>
                    {okSteps.has(s.id) && i <= reached ? <Check size={12} strokeWidth={3} /> : i + 1}
                  </span>
                  {s.label}
                  {okSteps.has(s.id) && i <= reached && <span className="sr-only">(done)</span>}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}

type StepProps = { d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; errs: Record<string, string> };

// ---- 1. Basics ---------------------------------------------------------------------------

function Basics({ d, set, errs }: StepProps) {
  const groups = GROUPS.filter((g) => g.active && g.slug !== "other");
  const subs = d.group ? childrenOf(d.group) : [];
  return (
    <>
      <Field label="Event name" htmlFor="ce-title" error={errs.title} counter={{ n: d.title.length, max: LIMITS.title[1] }}>
        <input id="ce-title" className="field !h-13 !text-[19px] font-semibold" placeholder="e.g. Fado by the River" value={d.title} maxLength={LIMITS.title[1] + 10} onChange={(e) => set("title", e.target.value)} autoFocus />
      </Field>
      <Field label="What kind of event?" error={errs.category}>
        <div role="radiogroup" aria-label="Kind of event" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {groups.map((g) => {
            const on = d.group === g.slug;
            return (
              <button
                key={g.slug}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => (set("group", g.slug), set("category", ""))}
                className={`ce-tile press ${on ? "ce-tile--on" : ""}`}
                style={on ? ({ ["--tile" as string]: GROUP_HEX[g.slug] ?? "#1463ff" } as React.CSSProperties) : undefined}
              >
                <CategoryIcon slug={g.slug} size={20} />
                <span className="text-[13.5px] font-semibold leading-tight">{g.name}</span>
              </button>
            );
          })}
        </div>
      </Field>
      {subs.length > 0 && (
        <Field label="The closest genre" optional hint="Helps people who filter by genre.">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Genre">
            {subs.map((c) => (
              <button key={c.slug} type="button" role="radio" aria-checked={d.category === c.slug} onClick={() => set("category", d.category === c.slug ? "" : c.slug)} className={`chip press ${d.category === c.slug ? "!bg-text !text-on-ink !border-text" : ""}`}>
                {c.name}
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field label="Styles and keywords" optional hint="Words people might search for: a style, a theme, a scene." htmlFor="ce-genres">
        <TagInput id="ce-genres" values={d.genres} onChange={(v) => set("genres", v)} placeholder="e.g. jazz, rooftop, vinyl" max={LIMITS.genres} maxLength={30} suggestions={GENRE_IDEAS[d.group] ?? []} />
      </Field>
      <Field label="One line to sell it" optional htmlFor="ce-tagline" error={errs.tagline} counter={{ n: d.tagline.length, max: LIMITS.tagline }}>
        <input id="ce-tagline" className="field" placeholder="e.g. Three voices, two guitars and the river at night" value={d.tagline} maxLength={LIMITS.tagline + 10} onChange={(e) => set("tagline", e.target.value)} />
      </Field>
    </>
  );
}

// ---- 2. Place ----------------------------------------------------------------------------

function Place({ d, setVenue, errs, tz, setCurrency }: { d: Draft; setVenue: (p: Partial<Draft["venue"]>) => void; errs: Record<string, string>; tz: { timeZone: string; label: string } | null; setCurrency: (c: string) => void }) {
  const v = d.venue;
  return (
    <>
      <Field label="Venue or place name" htmlFor="ce-venue" error={errs.venueName} hint="The name people will look for when they get there.">
        <input id="ce-venue" className="field" placeholder="e.g. Clube Ferroviário, Parque Eduardo VII, a rooftop…" value={v.name} maxLength={LIMITS.venueName[1]} onChange={(e) => setVenue({ name: e.target.value })} />
      </Field>
      <Field label="Location on the map" error={errs.pin}>
        <LocationPicker
          initialQuery={d.placeQuery}
          value={v.lat != null && v.lng != null ? { lat: v.lat, lng: v.lng } : null}
          onPick={(p) => {
            setVenue({
              lat: p.lat,
              lng: p.lng,
              ...(p.address !== undefined ? { address: p.address ?? "" } : {}),
              ...(p.city ? { city: p.city } : {}),
              ...(p.country ? { country: p.country } : {}),
              ...(p.countryCode ? { countryCode: p.countryCode.toUpperCase() } : {}),
              ...(p.name && !v.name ? { name: p.name } : {}),
            });
            if (p.countryCode) setCurrency(currencyFor(p.countryCode.toUpperCase()));
          }}
        />
      </Field>
      {v.lat != null && (
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr] panel-in">
          <Field label="Street address" optional htmlFor="ce-address">
            <input id="ce-address" className="field" value={v.address} maxLength={LIMITS.address} onChange={(e) => setVenue({ address: e.target.value })} placeholder="Street and number" />
          </Field>
          <Field label="City" htmlFor="ce-city" error={errs.city}>
            <input id="ce-city" className="field" value={v.city} maxLength={80} onChange={(e) => setVenue({ city: e.target.value })} />
          </Field>
          <Field label="Country" htmlFor="ce-country" error={errs.country}>
            <input id="ce-country" className="field" value={v.country} maxLength={80} onChange={(e) => setVenue({ country: e.target.value })} />
          </Field>
        </div>
      )}
      {tz && (
        <p className="flex items-start gap-2 t-small text-text-2">
          <Clock size={15} className="mt-0.5 shrink-0 text-text-3" aria-hidden />
          <span>Times will be in local time there: <strong className="text-text">{tz.timeZone.replace(/_/g, " ")}</strong> ({tz.label}).</span>
        </p>
      )}
    </>
  );
}

// ---- 3. When -----------------------------------------------------------------------------

function When({ d, set, errs, tz }: StepProps & { tz: { timeZone: string; label: string } | null }) {
  const [extra, setExtra] = useState("");
  const today = todayLocal();
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={d.multiDay ? "First day" : "Date"} htmlFor="ce-date" error={errs.date}>
          <input id="ce-date" type="date" className="field tnum" min={today} value={d.date} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <Field label="Starts" htmlFor="ce-time" error={errs.time}>
          <input id="ce-time" type="time" step={300} className="field tnum" value={d.time} onChange={(e) => set("time", e.target.value)} />
        </Field>
        <Field label="Ends" optional htmlFor="ce-end">
          <input id="ce-end" type="time" step={300} className="field tnum" value={d.endTime} onChange={(e) => set("endTime", e.target.value)} />
        </Field>
      </div>
      {d.endTime && d.time && d.endTime <= d.time && !d.multiDay && <p className="-mt-3 t-small text-text-2">Ends after midnight, on the next day.</p>}
      <Toggle checked={d.multiDay} onChange={(v) => (set("multiDay", v), v && set("repeat", "none"))} label="Runs over several days" hint="A festival, a fair, an exhibition…" />
      {d.multiDay && (
        <Field label="Last day" htmlFor="ce-enddate" error={errs.endDate} hint="Start and end times above apply to each day.">
          <input id="ce-enddate" type="date" className="field tnum sm:max-w-[16rem]" min={d.date ? addDays(d.date, 1) : today} value={d.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </Field>
      )}
      {!d.multiDay && (
        <Field label="Does it happen again?" error={errs.dates}>
          <Segmented<Draft["repeat"]>
            label="Repeats"
            value={d.repeat}
            onChange={(v) => set("repeat", v)}
            options={[
              { value: "none", label: "Just once" },
              { value: "weekly", label: "Every week" },
              { value: "dates", label: "On other dates" },
            ]}
          />
          {d.repeat === "weekly" && (
            <div className="mt-3 flex flex-wrap items-center gap-3 panel-in">
              <span className="t-small">For</span>
              <div className="inline-flex items-center rounded-full border border-line-strong">
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Fewer weeks" onClick={() => set("weeks", Math.max(LIMITS.weeks[0], d.weeks - 1))}><Minus size={14} aria-hidden /></button>
                <span className="w-8 text-center font-semibold tnum" aria-live="polite">{d.weeks}</span>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="More weeks" onClick={() => set("weeks", Math.min(LIMITS.weeks[1], d.weeks + 1))}><Plus size={14} aria-hidden /></button>
              </div>
              <span className="t-small">weeks{d.date ? `, until ${localDay(addDays(d.date, 7 * (d.weeks - 1)), { day: "numeric", month: "short" })}` : ""}</span>
            </div>
          )}
          {d.repeat === "dates" && (
            <div className="mt-3 grid gap-2 panel-in">
              <div className="flex gap-2">
                <label htmlFor="ce-extra" className="sr-only">Another date</label>
                <input id="ce-extra" type="date" className="field tnum max-w-[14rem]" min={d.date ? addDays(d.date, 1) : today} value={extra} onChange={(e) => setExtra(e.target.value)} />
                <button type="button" className="btn btn-secondary" disabled={!extra || d.dates.includes(extra) || d.dates.length >= LIMITS.extraDates} onClick={() => (set("dates", [...d.dates, extra].sort()), setExtra(""))}>
                  <Plus size={15} aria-hidden /> Add date
                </button>
              </div>
              {d.dates.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {d.dates.map((x) => (
                    <li key={x} className="inline-flex items-center gap-1 rounded-full bg-text/[0.07] pl-3 pr-1 py-1 t-small tnum">
                      {localDay(x, { weekday: "short", day: "numeric", month: "short" })}
                      <button type="button" className="grid h-5 w-5 place-items-center rounded-full hover:bg-text/10" aria-label={`Remove ${x}`} onClick={() => set("dates", d.dates.filter((y) => y !== x))}><X size={12} aria-hidden /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>
      )}
      {d.date && d.time && (
        <p className="rounded-[var(--radius-m)] bg-panel-2 px-4 py-3 t-small">
          <strong>{whenLine(d)}</strong>
          {tz && <span className="text-text-2"> · {tz.timeZone.split("/").pop()?.replace(/_/g, " ")} time</span>}
        </p>
      )}
    </>
  );
}

// ---- 4. Tickets --------------------------------------------------------------------------

function Tickets({ d, set, errs }: StepProps) {
  const setTier = (i: number, patch: Partial<Draft["tiers"][number]>) => set("tiers", d.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <>
      <Field label="Entry" error={errs.access}>
        <div role="radiogroup" aria-label="Entry" className="grid gap-2 sm:grid-cols-3">
          {ACCESS_KINDS.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={d.access === k.id} onClick={() => set("access", k.id)} className={`ce-choice press ${d.access === k.id ? "ce-choice--on" : ""}`}>
              <span className="text-2xl" aria-hidden>{k.emoji}</span>
              <span className="font-semibold">{k.label}</span>
              <span className="t-micro text-text-2">{k.hint}</span>
            </button>
          ))}
        </div>
      </Field>
      {d.access === "ticketed" && (
        <div className="grid gap-5 panel-in">
          <Field label="Ticket types" error={errs.tiers} hint="One line per kind of ticket: early bird, regular, VIP, student…">
            <div className="grid gap-2">
              {d.tiers.map((t, i) => (
                <div key={i} className="grid gap-1">
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`ce-tier-${i}`}>Ticket type {i + 1}</label>
                    <input id={`ce-tier-${i}`} className="field flex-1 min-w-0" placeholder="e.g. Regular" value={t.name} maxLength={LIMITS.tierName} onChange={(e) => setTier(i, { name: e.target.value })} />
                    <label className="sr-only" htmlFor={`ce-tier-price-${i}`}>Price of ticket type {i + 1}</label>
                    <input id={`ce-tier-price-${i}`} inputMode="decimal" className="field tnum w-28" placeholder="Price" value={t.price} onChange={(e) => setTier(i, { price: e.target.value.replace(/[^\d.,]/g, "") })} />
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${t.name || "this ticket type"}`} disabled={d.tiers.length === 1} onClick={() => set("tiers", d.tiers.filter((_, j) => j !== i))}>
                      <X size={15} aria-hidden />
                    </button>
                  </div>
                  {errs[`tier${i}`] && <p role="alert" className="t-small text-bad">{errs[`tier${i}`]}</p>}
                </div>
              ))}
              {d.tiers.length < LIMITS.tiers && (
                <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => set("tiers", [...d.tiers, { name: "", price: "" }])}>
                  <Plus size={15} aria-hidden /> Add a ticket type
                </button>
              )}
            </div>
          </Field>
          <Field label="Currency" htmlFor="ce-cur" error={errs.currency}>
            <select id="ce-cur" className="field sm:max-w-[10rem]" value={d.currency} onChange={(e) => set("currency", e.target.value)}>
              <option value="">Choose</option>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Where to buy tickets" optional htmlFor="ce-tix" error={errs.ticketUrl} hint="A link to the ticket page. No link? People will see the prices and the organiser.">
            <input id="ce-tix" type="url" inputMode="url" className="field" placeholder="https://…" value={d.ticketUrl} onChange={(e) => set("ticketUrl", e.target.value)} />
          </Field>
          <Toggle checked={d.soldOut} onChange={(v) => set("soldOut", v)} label="Sold out" hint="Keeps it listed, clearly marked." />
        </div>
      )}
      {d.access === "registration" && (
        <div className="grid gap-5 panel-in">
          <Field label="Where to sign up" optional htmlFor="ce-reg" error={errs.ticketUrl}>
            <input id="ce-reg" type="url" inputMode="url" className="field" placeholder="https://…" value={d.ticketUrl} onChange={(e) => set("ticketUrl", e.target.value)} />
          </Field>
          <Toggle checked={d.soldOut} onChange={(v) => set("soldOut", v)} label="Fully booked" hint="No places left right now." />
        </div>
      )}
      {d.access && (
        <Field label="How many people can come?" optional htmlFor="ce-cap" error={errs.capacity}>
          <input id="ce-cap" inputMode="numeric" className="field tnum sm:max-w-[12rem]" placeholder="e.g. 150" value={d.capacity} onChange={(e) => set("capacity", e.target.value.replace(/\D/g, ""))} />
        </Field>
      )}
    </>
  );
}

// ---- 5. Details --------------------------------------------------------------------------

function Details({ d, set, errs }: StepProps) {
  return (
    <>
      <Field
        label="Description"
        htmlFor="ce-desc"
        error={errs.description}
        counter={{ n: d.description.length, max: LIMITS.description[1] }}
        hint="What happens, who it's for, what to bring. Short paragraphs read best."
      >
        <textarea id="ce-desc" rows={8} className="field !h-auto py-3 leading-relaxed" placeholder={"An evening of live fado in an old railway club by the river.\n\nDoors open at 21:00; the first set starts at 21:30. Dinner is served from 20:00 (book ahead)."} value={d.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <Field label="Line-up" optional hint="Artists, speakers, teams or hosts. Press Enter after each." htmlFor="ce-people" error={errs.performers}>
        <TagInput id="ce-people" values={d.performers} onChange={(v) => set("performers", v)} placeholder="e.g. Ana Moura Trio" max={LIMITS.performers} maxLength={80} />
      </Field>
      <Field label="Programme" optional hint="The running order: doors, sets, talks, the last song…">
        <div className="grid gap-2" data-own-enter>
          {d.programme.map((it, i) => (
            <div key={i} className="grid gap-1">
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`ce-prog-t-${i}`}>Time</label>
                <input id={`ce-prog-t-${i}`} type="time" step={300} className="field tnum w-32" value={it.time} onChange={(e) => set("programme", d.programme.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} />
                <label className="sr-only" htmlFor={`ce-prog-${i}`}>What happens</label>
                <input id={`ce-prog-${i}`} className="field flex-1 min-w-0" placeholder="e.g. Doors open" maxLength={LIMITS.programmeTitle} value={it.title} onChange={(e) => set("programme", d.programme.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Remove this item" onClick={() => set("programme", d.programme.filter((_, j) => j !== i))}>
                  <X size={15} aria-hidden />
                </button>
              </div>
              {errs[`prog${i}`] && <p role="alert" className="t-small text-bad">{errs[`prog${i}`]}</p>}
            </div>
          ))}
          {d.programme.length < LIMITS.programme && (
            <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => set("programme", [...d.programme, { time: d.programme.at(-1)?.time || d.time || "", title: "" }])}>
              <Plus size={15} aria-hidden /> Add to the programme
            </button>
          )}
        </div>
      </Field>
      <Field label="Age">
        <Segmented<number> label="Age" value={d.ageMin} onChange={(v) => (set("ageMin", v), v >= 16 && set("familyFriendly", false))} options={AGE_OPTIONS.map((a) => ({ value: a.min, label: a.label }))} />
      </Field>
      <Toggle checked={d.familyFriendly && d.ageMin < 16} disabled={d.ageMin >= 16} onChange={(v) => set("familyFriendly", v)} label="Good for families" hint={d.ageMin >= 16 ? "Not with an age limit of 16 or more." : "Shows up for people looking for things to do with kids."} />
      <Field label="Accessibility" optional hint="Tick what's true at the venue.">
        <div className="flex flex-wrap gap-1.5">
          {ACCESSIBILITY_OPTIONS.map((a) => {
            const on = d.accessibility.includes(a);
            return (
              <button key={a} type="button" aria-pressed={on} onClick={() => set("accessibility", on ? d.accessibility.filter((x) => x !== a) : [...d.accessibility, a])} className={`chip press ${on ? "!bg-ok/15 !border-ok/50 !text-text" : ""}`}>
                {on && <Check size={13} aria-hidden />} {a}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Languages" optional hint="If people need to understand a language to enjoy it." htmlFor="ce-lang">
        <TagInput id="ce-lang" values={d.languages} onChange={(v) => set("languages", v)} placeholder="e.g. Portuguese" max={5} maxLength={30} suggestions={LANGUAGE_IDEAS} />
      </Field>
    </>
  );
}

// ---- 6. Look -----------------------------------------------------------------------------

function Look({ d, set, errs }: StepProps) {
  const [broken, setBroken] = useState(false);
  const url = cleanUrl(d.imageUrl, { https: true });
  useEffect(() => setBroken(false), [d.imageUrl]);
  const data = posterDataOf(d);
  return (
    <>
      <div className="overflow-hidden rounded-[var(--radius-l)] border border-line shadow-[0_24px_50px_-30px_rgb(13_27_51_/_0.6)]">
        {d.look === "photo" ? (
          url && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="aspect-[16/9] w-full object-cover bg-panel-2" onError={() => setBroken(true)} />
          ) : (
            <div className="grid aspect-[16/9] w-full place-items-center bg-panel-2 text-text-3 t-small">
              <span className="flex items-center gap-2"><ImageIcon size={16} aria-hidden /> Your picture shows here</span>
            </div>
          )
        ) : (
          <ScaledPoster data={data} styleId={d.look} className="w-full" />
        )}
      </div>
      <Field label="Style">
        <div role="radiogroup" aria-label="Poster style" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {POSTER_STYLES.map((st) => (
            <button key={st.id} type="button" role="radio" aria-checked={d.look === st.id} onClick={() => set("look", st.id)} className={`studio-style press ${d.look === st.id ? "studio-style--on" : ""}`}>
              <ScaledPoster data={data} styleId={st.id} className="w-full rounded-[8px]" label={`${st.label} style`} />
              <span className="mt-1.5 block font-semibold text-[13px]">{st.label}</span>
              <span className="block t-micro text-text-3">{st.hint}</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={d.look === "photo"} onClick={() => set("look", "photo")} className={`studio-style press ${d.look === "photo" ? "studio-style--on" : ""}`}>
            <span className="grid aspect-[16/9] w-full place-items-center rounded-[8px] bg-panel-2"><ImageIcon size={20} className="text-text-3" aria-hidden /></span>
            <span className="mt-1.5 block font-semibold text-[13px]">My picture</span>
            <span className="block t-micro text-text-3">A photo or your own flyer</span>
          </button>
        </div>
      </Field>
      {d.look === "photo" && (
        <Field label="Picture address" htmlFor="ce-img" error={errs.imageUrl || (broken && url ? "We couldn't load a picture from that address. Check it opens on its own." : undefined)} hint="Paste the address of a picture online (it must start with https://). Use one you're allowed to share.">
          <input id="ce-img" type="url" inputMode="url" className="field" placeholder="https://…/poster.jpg" value={d.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} />
        </Field>
      )}
      <Field label="Colour" hint={d.look === "photo" ? "Your event's accent colour." : "Sets the poster's colours."}>
        <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
          {HUES.map((h) => (
            <button key={h} type="button" role="radio" aria-checked={d.hue === h} aria-label={`Colour ${h}`} onClick={() => set("hue", h)} className={`h-9 w-9 rounded-full border-2 press ${d.hue === h ? "border-text scale-110" : "border-transparent"}`} style={{ background: `linear-gradient(135deg, hsl(${h} 85% 70%), hsl(${(h + 40) % 360} 75% 50%))` }} />
          ))}
        </div>
      </Field>
    </>
  );
}

// ---- 7. Publish --------------------------------------------------------------------------

function Publish({ d, set, errs, go, signedIn, editing }: StepProps & { go: (i: number) => void; signedIn: boolean; editing: boolean }) {
  const idx = (id: StepId) => STEPS.findIndex((s) => s.id === id);
  const cat = getCategory(d.category || d.group);
  const rows: [StepId, string, React.ReactNode][] = [
    ["basics", "Event", <><strong>{d.title || "—"}</strong>{cat ? ` · ${cat.name}` : ""}{d.genres.length ? ` · ${d.genres.join(", ")}` : ""}</>],
    ["place", "Place", <>{d.venue.name || "—"}{d.venue.city ? `, ${d.venue.city}` : ""}{d.venue.country ? `, ${d.venue.country}` : ""}</>],
    ["when", "When", whenLine(d)],
    ["tickets", "Entry", <>{priceLine(d)}{d.access === "ticketed" && d.tiers.length > 1 ? ` · ${d.tiers.length} ticket types` : ""}{d.ticketUrl ? " · with link" : ""}{d.capacity ? ` · ${d.capacity} people` : ""}</>],
    ["details", "Details", <>{d.description ? `${d.description.slice(0, 90)}${d.description.length > 90 ? "…" : ""}` : "—"}{d.performers.length ? ` · ${d.performers.length} in the line-up` : ""}{d.programme.length ? ` · ${d.programme.length} in the programme` : ""}{` · ${AGE_OPTIONS.find((a) => a.min === d.ageMin)?.label}`}</>],
    ["look", "Poster", d.look === "photo" ? "Your picture" : `Studio poster, ${POSTER_STYLES.find((x) => x.id === d.look)?.label ?? "Bold"} style`],
  ];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Organiser" htmlFor="ce-org" error={errs.organiserName} hint="Shown on the event, as who's behind it.">
          <input id="ce-org" className="field" value={d.organiserName} maxLength={80} onChange={(e) => set("organiserName", e.target.value)} placeholder="You, a collective, a venue…" />
        </Field>
        <Field label="Organiser's website or Instagram" optional htmlFor="ce-orgurl" error={errs.organiserUrl}>
          <input id="ce-orgurl" type="url" inputMode="url" className="field" value={d.organiserUrl} onChange={(e) => set("organiserUrl", e.target.value)} placeholder="https://instagram.com/…" />
        </Field>
      </div>
      <Field label="Official event page" optional htmlFor="ce-web" error={errs.website} hint="Where people can read more, if it has a page elsewhere.">
        <input id="ce-web" type="url" inputMode="url" className="field" value={d.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" />
      </Field>

      <div className="rounded-[var(--radius-l)] border border-line">
        <p className="px-4 pt-3 font-semibold">Your answers</p>
        <dl className="divide-y divide-line">
          {rows.map(([id, label, value]) => (
            <div key={id} className="flex items-start gap-3 px-4 py-2.5">
              <dt className="w-16 shrink-0 t-small text-text-3">{label}</dt>
              <dd className="min-w-0 flex-1 t-small break-words">{value}</dd>
              <button type="button" className="btn btn-ghost btn-sm -my-1 shrink-0" onClick={() => go(idx(id))} aria-label={`Edit ${label.toLowerCase()}`}>
                <Pencil size={13} aria-hidden /> Edit
              </button>
            </div>
          ))}
        </dl>
      </div>

      <label className={`flex items-start gap-3 rounded-[var(--radius-m)] border p-3.5 cursor-pointer ${errs.agree ? "border-bad/50 bg-bad/5" : "border-line"}`}>
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--cyan)]" checked={d.agree} onChange={(e) => set("agree", e.target.checked)} />
        <span className="t-small">
          I organise this event or have permission to list it, and the details are accurate. I understand members can report listings that aren&apos;t.
          {errs.agree && <span role="alert" className="block text-bad mt-1">{errs.agree}</span>}
        </span>
      </label>
      {!signedIn && !editing && <p className="t-small text-text-2">You&apos;ll be asked to create a free account (about a minute). Your answers stay right here.</p>}
    </>
  );
}

// ---- Preview and the finish ----------------------------------------------------------------

function PreviewCard({ d }: { d: Draft }) {
  const url = cleanUrl(d.imageUrl, { https: true });
  const cat = getCategory(d.category || d.group);
  return (
    <article className="overflow-hidden rounded-[var(--radius-l)] border border-line bg-panel shadow-[0_18px_40px_-28px_rgb(13_27_51_/_0.5)]">
      <div className="relative">
        {d.look === "photo" ? (
          <Poster title={d.title || "Your event"} imageUrl={url} hue={d.hue} categorySlug={d.category || d.group || "other"} className="aspect-[16/9] w-full" />
        ) : (
          <ScaledPoster data={posterDataOf(d)} styleId={d.look} className="w-full" />
        )}
        {d.date && (
          <span className="absolute left-2.5 top-2.5 rounded-[10px] bg-panel/95 px-2 py-1 text-center leading-none shadow-sm tnum">
            <span className="block text-[10px] font-semibold uppercase text-text-3">{localDay(d.date, { month: "short" })}</span>
            <span className="block text-lg font-bold">{localDay(d.date, { day: "numeric" })}</span>
          </span>
        )}
      </div>
      <div className="p-3.5">
        <p className="flex items-center gap-1.5 text-[12px] text-text-2">
          {cat ? <CategoryIcon slug={cat.slug} size={13} /> : <Sparkles size={13} aria-hidden />}
          {cat?.name ?? "Category"}
        </p>
        <p className={`font-semibold leading-snug mt-0.5 line-clamp-2 ${d.title ? "" : "text-text-3"}`}>{d.title || "Your event's name"}</p>
        {d.tagline && <p className="t-small text-text-2 line-clamp-2 mt-0.5">{d.tagline}</p>}
        <p className="t-small text-text-3 mt-1.5 flex items-center gap-1.5"><Clock size={12} aria-hidden /> {whenLine(d)}</p>
        <p className="t-small text-text-3 flex items-center gap-1.5 truncate"><MapPin size={12} aria-hidden /> <span className="truncate">{d.venue.name || "Venue"}{d.venue.city ? `, ${d.venue.city}` : ""}</span></p>
        <p className={`t-small mt-1.5 font-semibold flex items-center gap-1.5 ${d.access === "ticketed" ? "text-text" : d.access ? "text-ok" : "text-text-3"}`}><Ticket size={12} aria-hidden /> {priceLine(d)}</p>
      </div>
    </article>
  );
}

function Done({ d, slug, updated, onAnother }: { d: Draft; slug: string; updated: boolean; onAnother: () => void }) {
  const url = typeof window !== "undefined" ? `${location.origin}/events/${slug}` : `/events/${slug}`;
  const share = async () => {
    const text = `${d.title}: ${whenLine(d)}, ${d.venue.name}`;
    try {
      if (navigator.share) await navigator.share({ title: d.title, text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast({ title: "Link copied", emoji: "📋" });
      }
    } catch {
      // the share sheet was closed
    }
  };
  return (
    <main id="main" className="pb-16">
      <section className="studio-stage">
        <div className="mx-auto max-w-[720px] px-4 sm:px-6 py-12 text-center relative">
          <span className="absolute left-1/2 top-16" aria-hidden><Burst colors={["#ffe29a", "#f5c451", "#ffffff", "#ff7aa8", "#8b5cf6"]} /></span>
          <p className="text-5xl" aria-hidden>{updated ? "✅" : "🎉"}</p>
          <h1 className="t-h1 mt-3 text-white">{updated ? "Changes saved" : <>Your event is <span className="studio-text">live</span></>}</h1>
          <p className="t-body text-white/80 mt-2">{updated ? "Everyone sees the new version within a minute." : "It's on the globe, in search and on its city's page. Share it so people know."}</p>
        </div>
      </section>
      <div className="mx-auto max-w-[420px] px-4 -mt-6 grid gap-4">
        <PreviewCard d={d} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Link href={`/events/${slug}`} className="btn btn-primary press w-full justify-center">See your event <ExternalLink size={15} aria-hidden /></Link>
          <button type="button" className="btn btn-secondary press w-full justify-center" onClick={() => void share()}><Share2 size={15} aria-hidden /> Share</button>
        </div>
        <div className="flex justify-center gap-2">
          <Link href="/studio" className="btn btn-ghost btn-sm">Back to Studio</Link>
          {!updated && <button type="button" className="btn btn-ghost btn-sm" onClick={onAnother}><Plus size={14} aria-hidden /> List another</button>}
        </div>
      </div>
    </main>
  );
}
