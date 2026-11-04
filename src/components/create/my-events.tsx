"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Flag, Pencil, Sparkles } from "lucide-react";
import { myEventsGet, myEventsPost, useMe } from "@/lib/community/client";
import { formatEventDate, formatEventTime } from "@/lib/format";
import { requireMember } from "../community/bits";
import { CategoryIcon, Poster } from "../ui";
import { toast } from "../toast";

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

/** My World: the events this member listed, with a way to edit each and to list another. */
export function MyEvents() {
  const { profile, loaded } = useMe();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!profile?.username) return;
    myEventsGet<{ events: Row[] }>().then(
      (r) => setRows(r.events),
      (e) => setError(e instanceof Error ? e.message : "Couldn't load your events."),
    );
  }, [profile?.username]);

  const now = Date.now();
  const upcoming = (rows ?? []).filter((r) => Date.parse(r.start) > now - 864e5);
  const past = (rows ?? []).filter((r) => Date.parse(r.start) <= now - 864e5);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <h1 className="t-h1">My events</h1>
        <Link href="/events/new" className="btn btn-gold press">
          <Sparkles size={16} aria-hidden /> List an event
        </Link>
      </div>
      {loaded && !profile?.username ? (
        <div className="rounded-[var(--radius-l)] border border-dashed border-line-strong p-6">
          <p className="t-h3">Organising something?</p>
          <p className="t-small text-text-2 mt-1">List it in a few steps and it shows up on the globe, in search and on its city&apos;s page. You&apos;ll need a free account.</p>
          <div className="mt-4 flex gap-2">
            <Link href="/events/new" className="btn btn-primary btn-sm">List an event</Link>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void requireMember(false)}>Sign in</button>
          </div>
        </div>
      ) : error ? (
        <p role="alert" className="rounded-[var(--radius-m)] border border-bad/30 bg-bad/5 p-4 t-small">{error}</p>
      ) : !rows ? (
        <div className="grid gap-3" aria-hidden>{[0, 1].map((i) => <div key={i} className="skeleton h-20" />)}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-[var(--radius-l)] border border-dashed border-line-strong p-6">
          <CalendarPlus size={24} className="text-cyan" aria-hidden />
          <p className="t-h3 mt-2">You haven&apos;t listed anything yet</p>
          <p className="t-small text-text-2 mt-1">A concert, a market, a run club, a supper: if it&apos;s happening, put it on the map.</p>
          <Link href="/events/new" className="btn btn-primary btn-sm mt-4">List your first event</Link>
        </div>
      ) : (
        <>
          <List rows={upcoming} title="Coming up" />
          {past.length > 0 && <List rows={past} title="Past" muted />}
        </>
      )}
    </>
  );
}

function List({ rows, title, muted }: { rows: Row[]; title: string; muted?: boolean }) {
  if (!rows.length) return null;
  return (
    <section className={`mb-8 ${muted ? "opacity-75" : ""}`} aria-label={title}>
      <h2 className="t-h3 mb-2">{title}</h2>
      <ul className="divide-y divide-line rounded-[var(--radius-l)] border border-line bg-panel">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 p-3">
            <Poster title={r.title} imageUrl={r.imageUrl} hue={r.hue} categorySlug={r.category} size="sm" className="h-14 w-14 shrink-0 rounded-[var(--radius-s)]" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[12px] text-text-2"><CategoryIcon slug={r.category} size={13} /> {r.city}</p>
              <Link href={`/events/${r.slug}`} className="block font-semibold truncate hover:text-cyan">{r.title}</Link>
              <p className="t-small text-text-3 tnum">
                {formatEventDate(r.start, r.timeZone)}, {formatEventTime(r.start, r.timeZone)}
                {r.cancelled && <span className="ml-2 font-semibold text-bad">Cancelled</span>}
                {r.hidden && <span className="ml-2 font-semibold text-warn">Hidden after reports</span>}
              </p>
            </div>
            <Link href={`/events/new?edit=${r.id}`} className="btn btn-secondary btn-sm shrink-0">
              <Pencil size={14} aria-hidden /> Edit
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** On a member-listed event's page: who listed it; the owner gets "Edit", others can report it. */
export function ListedBy({ id, ownerId, name, username, organiser, organiserUrl }: { id: string; ownerId: string; name: string; username?: string; organiser: string; organiserUrl?: string }) {
  const { profile } = useMe();
  const [reported, setReported] = useState(false);
  const mine = profile?.id === ownerId;
  const report = async () => {
    if (!window.confirm("Report this listing as fake, spam or wrong? Three reports take it off the site until it's checked.")) return;
    if (!(await requireMember(!!profile))) return;
    try {
      await myEventsPost({ action: "report", id });
      setReported(true);
      toast({ title: "Thanks for reporting", body: "It helps keep listings honest.", emoji: "🚩" });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Couldn't report it", emoji: "⚠️" });
    }
  };
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-m)] border border-[var(--gold)]/40 bg-[var(--gold)]/[0.07] px-4 py-3 t-small">
      <Sparkles size={15} className="text-[#b77900] shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        Organised by{" "}
        {organiserUrl ? (
          <a href={organiserUrl} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold underline decoration-line-strong hover:text-cyan">{organiser}</a>
        ) : (
          <strong>{organiser}</strong>
        )}
        <span className="text-text-2">
          {" "}·{" "}
          {organiser.trim().toLowerCase() === name.trim().toLowerCase() ? (
            <>listed by them as <Link href={`/community/u/${ownerId}`} className="hover:text-text underline decoration-line-strong">{username ? `@${username}` : "a member"}</Link>.</>
          ) : (
            <>listed by <Link href={`/community/u/${ownerId}`} className="hover:text-text underline decoration-line-strong">{name}{username ? ` (@${username})` : ""}</Link>, a member.</>
          )}{" "}
          Check details with the organiser.
        </span>
      </span>
      {mine ? (
        <Link href={`/events/new?edit=${id}`} className="btn btn-secondary btn-sm"><Pencil size={14} aria-hidden /> Edit your event</Link>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm text-text-2" onClick={() => void report()} disabled={reported}>
          <Flag size={14} aria-hidden /> {reported ? "Reported" : "Report"}
        </button>
      )}
    </div>
  );
}
