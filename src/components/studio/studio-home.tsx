"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Copy, ExternalLink, Pencil, PenLine, Share2, Wand2 } from "lucide-react";
import { extractEvent } from "@/lib/studio/magic";
import { TEMPLATES } from "@/lib/studio/templates";
import { posterWhen, type PosterData, type PosterStyle } from "@/lib/studio/poster";
import { getCategory } from "@/lib/categories";
import { myEventsGet, useMe } from "@/lib/community/client";
import { formatEventDate, formatEventTime } from "@/lib/format";
import { requireMember } from "../community/bits";
import { CategoryIcon, Poster } from "../ui";
import { toast } from "../toast";
import { PASTE_KEY } from "@/lib/studio/keys";
import { ScaledPoster } from "./scaled-poster";

const SHOWCASE: { data: PosterData; style: PosterStyle }[] = [
  { style: "bold", data: { title: "Noite de Fado", tagline: "Three voices, two guitars, the river", date: "SAT 14 NOV", time: "21:30", venue: "Clube Ferroviário", city: "Lisboa", price: "€12", category: "Music", hue: 265 } },
  { style: "neon", data: { title: "Warehouse Techno", date: "FRI 20 NOV", time: "23:00", venue: "Armazém 16", city: "Porto", price: "FROM €8", category: "Nightlife", hue: 300 } },
  { style: "retro", data: { title: "Sunset Run Club", tagline: "All paces, coffee after", date: "SUN 15 NOV", time: "08:00", venue: "Torre de Belém", city: "Lisboa", price: "FREE", category: "Sports", hue: 25 } },
  { style: "minimal", data: { title: "Open Studio Night", date: "THU 19 NOV", time: "19:00", venue: "Galeria Zé dos Bois", city: "Lisboa", price: "FREE", category: "Exhibitions", hue: 220 } },
];

const EXAMPLE = `🎷 NOITE DE JAZZ NO TEJO 🎷
Sábado, 28 de novembro, das 21h30 às 23h30
📍 Clube Ferroviário, Lisboa
Bilhetes: 12€ antecipado / 15€ à porta
Com Maria João e Mário Laginha
Uma noite de jazz à beira-rio, num clube com 100 anos de história. Jantar a partir das 20h.
https://tickets.example.com/jazz-tejo
#jazz #livemusic`;

interface Row {
  id: string;
  slug: string;
  title: string;
  start: string;
  timeZone: string;
  city: string;
  category: string;
  cancelled?: boolean;
  hidden?: boolean;
  imageUrl?: string;
  hue: number;
}

/** OMNIEVENT Studio: where organisers make and manage their events. */
export function StudioHome() {
  const router = useRouter();
  const { profile, loaded } = useMe();
  const [text, setText] = useState("");
  const found = useMemo(() => (text.trim().length >= 8 ? extractEvent(text) : null), [text]);

  const fill = () => {
    if (!found) return;
    try {
      localStorage.setItem(PASTE_KEY, JSON.stringify(found));
    } catch {
      // storage unavailable: the questionnaire starts empty
    }
    router.push("/studio/new?from=paste");
  };

  return (
    <main id="main" className="pb-20">
      <section className="studio-stage studio-hero">
        <div className="mx-auto max-w-[1300px] px-4 sm:px-6 pt-10 pb-14 sm:pt-14 sm:pb-20 grid gap-10 lg:grid-cols-[1fr_1.05fr] items-center">
          <div className="relative z-10">
            <p className="studio-mark t-small">OMNIEVENT Studio</p>
            <h1 className="t-display mt-3 text-white text-balance">
              Make it happen.
              <br />
              <span className="studio-text">Put it on the map.</span>
            </h1>
            <p className="t-lede text-white/80 mt-4 measure">
              Everything an organiser needs: paste your announcement and it fills itself in, a poster that designs itself, and the whole planet as your billboard. Free.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/studio/new" className="btn studio-btn press !h-12 px-6 text-[15px]">
                Create an event <ArrowRight size={17} aria-hidden />
              </Link>
              <a href="#magic" className="btn press !h-12 px-5 border border-white/25 bg-white/10 text-white hover:bg-white/15">
                <Wand2 size={17} aria-hidden /> Paste an announcement
              </a>
            </div>
          </div>
          <Showcase />
        </div>
      </section>

      <div className="mx-auto max-w-[1300px] px-4 sm:px-6">
        {/* ---- Three ways in ---- */}
        <section id="magic" aria-labelledby="start-h" className="-mt-8 relative z-10 grid gap-4 lg:grid-cols-[1.6fr_1fr] scroll-mt-24">
          <div className="surface rounded-[var(--radius-l)] p-5 sm:p-6 studio-glow">
            <h2 id="start-h" className="t-h3 flex items-center gap-2">
              <Wand2 size={19} className="text-[var(--studio)]" aria-hidden /> Magic paste
            </h2>
            <p className="t-small text-text-2 mt-1">
              Paste your Instagram caption, WhatsApp message or flyer text. The Studio picks out the name, date, time, place, prices, links and line-up, in Portuguese, English, Spanish or French.
            </p>
            <label htmlFor="studio-paste" className="sr-only">Your announcement</label>
            <textarea id="studio-paste" rows={6} className="field mt-3 !h-auto py-3 leading-relaxed" placeholder={"🎷 Noite de Jazz no Tejo\nSábado, 28 de novembro, 21h30\n📍 Clube Ferroviário, Lisboa\nBilhetes 12€…"} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {found && found.found.length > 0 ? (
                <ul className="flex flex-1 flex-wrap gap-1.5" aria-label="Found in your text">
                  {found.found.map((f) => (
                    <li key={f} className="studio-found">✓ {f}</li>
                  ))}
                </ul>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText(EXAMPLE)}>
                  Try an example
                </button>
              )}
              <span className="flex-1" />
              <button type="button" className="btn studio-btn press" disabled={!found?.found.length} onClick={fill}>
                <Wand2 size={16} aria-hidden /> Fill it in for me
              </button>
            </div>
            {found && (found.title || found.date) && (
              <p className="mt-3 t-small text-text-2 panel-in">
                <strong className="text-text">{found.title ?? "Your event"}</strong>
                {found.date ? ` · ${new Date(`${found.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}` : ""}
                {found.time ? `, ${found.time}` : ""}
                {found.venueName ? ` · ${found.venueName}` : ""}
                {found.prices.length ? ` · ${found.prices.map((p) => `${p}`).join(" / ")} ${found.currency ?? ""}` : found.free ? " · free" : ""}
              </p>
            )}
          </div>
          <Link href="/studio/new" className="surface group rounded-[var(--radius-l)] p-5 sm:p-6 flex flex-col hover:border-line-strong press">
            <h2 className="t-h3 flex items-center gap-2">
              <PenLine size={19} className="text-cyan" aria-hidden /> From scratch
            </h2>
            <p className="t-small text-text-2 mt-1 flex-1">Seven guided steps, a live preview as you type, and your draft kept on this device.</p>
            <ol className="mt-4 grid gap-1.5 t-small text-text-2">
              {["Basics & genre", "Place on the map", "Dates & repeats", "Ticket types", "Details & programme", "Poster", "Publish"].map((s, i) => (
                <li key={s} className="flex items-center gap-2">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-text/[0.07] text-[11px] font-bold tnum" aria-hidden>{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <span className="btn btn-primary mt-5 justify-center">Start from scratch <ArrowRight size={16} aria-hidden /></span>
          </Link>
        </section>

        {/* ---- Templates ---- */}
        <section aria-labelledby="tpl-h" className="mt-14">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="tpl-h" className="t-h2">Start from a template</h2>
              <p className="t-small text-text-2 mt-1">Times, tickets, a programme and a description to adapt, already filled in.</p>
            </div>
          </div>
          <ul className="mt-5 grid grid-cols-2 gap-x-2 gap-y-3 sm:gap-4 lg:grid-cols-4 stagger">
            {TEMPLATES.map((t) => {
              const w = posterWhen(nextSaturday(), t.time);
              const price = t.access === "ticketed" && t.tiers ? `${t.tiers.length > 1 ? "FROM " : ""}€${Math.min(...t.tiers.map((x) => x.price))}` : t.access === "registration" ? "FREE · SIGN UP" : "FREE";
              return (
                <li key={t.id}>
                  <Link href={`/studio/new?template=${t.id}`} className="studio-tpl group block press">
                    <ScaledPoster data={{ title: t.name, date: w.date, time: w.time, venue: "Your venue", city: "Your city", price, category: getCategory(t.category ?? t.group)?.name, hue: t.hue }} styleId={t.posterStyle} className="w-full rounded-[12px] transition-transform duration-500 group-hover:scale-[1.02]" />
                    <span className="mt-2.5 flex items-center gap-2 font-semibold">
                      <span aria-hidden>{t.emoji}</span> {t.name}
                    </span>
                    <span className="block t-small text-text-2 max-sm:hidden">{t.blurb}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ---- Your events ---- */}
        <section aria-labelledby="mine-h" className="mt-16">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="mine-h" className="t-h2">Your events</h2>
            <Link href="/studio/new" className="btn btn-secondary btn-sm">＋ New event</Link>
          </div>
          {loaded && !profile?.username ? (
            <div className="mt-4 rounded-[var(--radius-l)] border border-dashed border-line-strong p-6">
              <p className="font-semibold">Sign in to see the events you&apos;ve listed</p>
              <p className="t-small text-text-2 mt-1">You can start an event now; you&apos;ll be asked for a free account when you publish.</p>
              <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => void requireMember(false)}>Sign in</button>
            </div>
          ) : (
            <MyStudioEvents />
          )}
        </section>

        {/* ---- Why ---- */}
        <section aria-label="Why the Studio" className="mt-16 grid gap-4 sm:grid-cols-3">
          {[
            ["🌍", "On the globe, in a minute", "Your event appears on the 3D globe, in search, on its city's page and in Spin the globe."],
            ["🎨", "A poster that designs itself", "Four styles from your details, used on cards, your page and when people share the link."],
            ["🎟️", "Free, and your tickets stay yours", "Link your own ticket page. We never sell tickets or take a cut."],
          ].map(([emoji, title, body]) => (
            <div key={title} className="rounded-[var(--radius-l)] border border-line p-5">
              <p className="text-2xl" aria-hidden>{emoji}</p>
              <p className="font-semibold mt-2">{title}</p>
              <p className="t-small text-text-2 mt-1">{body}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

function nextSaturday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Posters shuffling on the stage; the front one changes every few seconds (still for reduced motion). */
function Showcase() {
  const [front, setFront] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setFront((f) => (f + 1) % SHOWCASE.length), 3600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="studio-showcase relative mx-auto w-full max-w-[560px] aspect-[16/11]" aria-hidden>
      {SHOWCASE.map((p, i) => {
        const pos = (i - front + SHOWCASE.length) % SHOWCASE.length;
        return (
          <div key={p.data.title} className="studio-card" data-pos={pos}>
            <ScaledPoster data={p.data} styleId={p.style} className="w-full rounded-[14px]" />
          </div>
        );
      })}
    </div>
  );
}

function MyStudioEvents() {
  const { profile } = useMe();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!profile?.username) return;
    myEventsGet<{ events: Row[] }>().then(
      (r) => setRows(r.events),
      (e) => setError(e instanceof Error ? e.message : "Couldn't load your events."),
    );
  }, [profile?.username]);
  const share = async (r: Row) => {
    const url = `${location.origin}/events/${r.slug}`;
    try {
      if (navigator.share) await navigator.share({ title: r.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast({ title: "Link copied", emoji: "📋" });
      }
    } catch {
      // the share sheet was closed
    }
  };
  if (error) return <p role="alert" className="mt-4 rounded-[var(--radius-m)] border border-warn/30 bg-warn/5 p-4 t-small">{error}</p>;
  if (!rows) return <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>{[0, 1, 2].map((i) => <div key={i} className="skeleton h-56 rounded-[var(--radius-l)]" />)}</div>;
  if (!rows.length)
    return (
      <div className="mt-4 rounded-[var(--radius-l)] border border-dashed border-line-strong p-6">
        <p className="font-semibold">Nothing listed yet</p>
        <p className="t-small text-text-2 mt-1">A concert, a market, a run club, a supper: if it&apos;s happening, put it on the map.</p>
      </div>
    );
  const now = Date.now();
  return (
    <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => {
        const past = Date.parse(r.start) < now - 864e5;
        const status = r.hidden ? ["Hidden after reports", "bg-warn/15 text-warn"] : r.cancelled ? ["Cancelled", "bg-bad/10 text-bad"] : past ? ["Past", "bg-text/[0.07] text-text-2"] : ["Live", "bg-ok/15 text-ok"];
        return (
          <li key={r.id} className="overflow-hidden rounded-[var(--radius-l)] border border-line bg-panel">
            <div className="relative">
              <Poster title={r.title} imageUrl={r.imageUrl} hue={r.hue} categorySlug={r.category} className="aspect-[16/9] w-full" />
              <span className={`absolute left-2.5 top-2.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold backdrop-blur ${status[1]}`}>{status[0]}</span>
            </div>
            <div className="p-3.5">
              <p className="flex items-center gap-1.5 text-[12px] text-text-2"><CategoryIcon slug={r.category} size={13} /> {r.city}</p>
              <p className="font-semibold truncate mt-0.5">{r.title}</p>
              <p className="t-small text-text-3 tnum">{formatEventDate(r.start, r.timeZone)}, {formatEventTime(r.start, r.timeZone)}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Link href={`/events/${r.slug}`} className="btn btn-secondary btn-sm"><ExternalLink size={13} aria-hidden /> View</Link>
                <Link href={`/studio/new?edit=${r.id}`} className="btn btn-secondary btn-sm"><Pencil size={13} aria-hidden /> Edit</Link>
                <Link href={`/studio/new?duplicate=${r.id}`} className="btn btn-ghost btn-sm" title="A copy for another date"><Copy size={13} aria-hidden /> Duplicate</Link>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Share ${r.title}`} onClick={() => void share(r)}><Share2 size={14} aria-hidden /></button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
