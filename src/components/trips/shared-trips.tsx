"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, Flag, Heart, Loader2, Share2, Users, X } from "lucide-react";
import type { Trip } from "@/lib/user/store";
import { userActions } from "@/lib/user/store";
import { nightsBetween, flagOf } from "@/lib/trip";
import { routeParam } from "@/lib/travel/route-param";
import { CommunityRequestError, sharedTripsGet, sharedTripsPost } from "@/lib/community/client";
import type { SharedTripCard } from "@/lib/community/shared-trips";
import { Avatar } from "../community/bits";
import { requireMember } from "../community/bits";
import { toast } from "../toast";
import { RouteSketch } from "./route-sketch";

/*
 * Trips people share: a card for each, a rail of them on the ideas page, the list of them all,
 * and the Share dialog on your own trip.
 */

/** The planner's address for a shared trip. */
export function sharedPlanHref(t: Pick<SharedTripCard, "id" | "stops" | "name" | "emoji">): string {
  const q = new URLSearchParams({ route: routeParam(t.stops), name: t.name, emoji: t.emoji, from: t.id });
  return `/trips/new?${q}`;
}

export function SharedCard({ t }: { t: SharedTripCard }) {
  const flags = [...new Set(t.stops.map((s) => flagOf(s.cc)).filter(Boolean))].join(" ");
  return (
    <Link href={`/trips/s/${t.id}`} className="shared-card press">
      <span className="shared-card-map"><RouteSketch stops={t.stops} /></span>
      <span className="shared-card-body">
        <span className="shared-card-title"><span aria-hidden>{t.emoji}</span> {t.name}</span>
        <span className="block t-micro text-text-2 truncate mt-0.5">{t.stops.map((s) => s.name).join(" → ")}</span>
        <span className="shared-card-foot">
          <Avatar p={t.by} size={20} />
          <span className="truncate">{t.by?.username ? `@${t.by.username}` : "A traveller"}</span>
          <span className="ml-auto tnum shrink-0 text-text-2">{t.nights}n <span aria-hidden>{flags}</span></span>
          <span className="shared-card-likes tnum" aria-label={`${t.likes} likes`}><Heart size={12} aria-hidden fill={t.liked ? "currentColor" : "none"} /> {t.likes}</span>
        </span>
      </span>
    </Link>
  );
}

/** Trips people shared, the most liked first: a rail on the ideas page. */
export function SharedTripsRail() {
  const [trips, setTrips] = useState<SharedTripCard[] | null>(null);
  useEffect(() => {
    sharedTripsGet<{ trips: SharedTripCard[] }>("sort=top&limit=12")
      .then((r) => setTrips(r.trips))
      .catch(() => setTrips([]));
  }, []);
  return (
    <section className="mt-8" aria-labelledby="shared-rail-h">
      <div className="flex items-end justify-between gap-3">
        <h2 id="shared-rail-h" className="t-h3 flex items-center gap-2"><Users size={18} className="text-cyan" aria-hidden /> From travellers</h2>
        {trips && trips.length > 0 && <Link href="/trips/shared" className="see-all whitespace-nowrap">See all <ArrowRight size={14} aria-hidden /></Link>}
      </div>
      {trips?.length === 0 ? (
        <Link href="/trips" className="shared-empty press">
          <span className="shared-card-cta-icon" aria-hidden><Share2 size={18} /></span>
          <span className="min-w-0">
            <span className="block font-semibold">Be the first to share a trip</span>
            <span className="block t-micro text-text-2">Open one of your trips and press Share. Others can plan theirs from it.</span>
          </span>
          <ArrowRight size={16} aria-hidden className="ml-auto shrink-0" />
        </Link>
      ) : (
      <ul className="shared-rail no-scrollbar">
        <li>
          <Link href="/trips" className="shared-card shared-card-cta press">
            <span className="shared-card-cta-icon" aria-hidden><Share2 size={20} /></span>
            <span className="font-semibold">Share your trip</span>
            <span className="t-micro text-text-2">Open one of your trips and press Share. Others can plan theirs from it.</span>
          </Link>
        </li>
        {trips === null
          ? [0, 1, 2].map((i) => <li key={i}><div className="shared-card skeleton" /></li>)
          : trips.map((t) => (
              <li key={t.id}>
                <SharedCard t={t} />
              </li>
            ))}
      </ul>
      )}
    </section>
  );
}

/** Every shared trip, liked or newest first, in pages. */
export function SharedTripsList() {
  const [sort, setSort] = useState<"top" | "new">("top");
  const [trips, setTrips] = useState<SharedTripCard[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [down, setDown] = useState<string | null>(null);
  const load = useCallback(
    async (offset: number) => {
      setBusy(true);
      try {
        const r = await sharedTripsGet<{ trips: SharedTripCard[]; total: number }>(`sort=${sort}&offset=${offset}&limit=24`);
        setTrips((list) => (offset ? [...list, ...r.trips] : r.trips));
        setTotal(r.total);
      } catch (err) {
        setDown(err instanceof CommunityRequestError ? err.message : "Shared trips didn't load. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [sort],
  );
  useEffect(() => {
    setTrips([]);
    void load(0);
  }, [load]);
  return (
    <main className="mx-auto max-w-[1200px] px-4 sm:px-6 pt-8 pb-16">
      <p className="t-small font-semibold text-text-2"><Link href="/trips" className="hover:underline">Trips</Link> / <Link href="/trips/ideas" className="hover:underline">Ideas</Link></p>
      <h1 className="t-display mt-1">From travellers</h1>
      <p className="t-lede text-text-2 mt-2 measure">Trips people planned and shared. Open one, like it, or make it yours and change anything.</p>
      <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="Order">
        <button type="button" className="chip press" data-active={sort === "top" || undefined} aria-pressed={sort === "top"} onClick={() => setSort("top")}>Most liked</button>
        <button type="button" className="chip press" data-active={sort === "new" || undefined} aria-pressed={sort === "new"} onClick={() => setSort("new")}>Newest</button>
        <Link href="/trips" className="btn btn-secondary btn-sm ml-auto press"><Share2 size={14} aria-hidden /> Share yours</Link>
      </div>
      {down && <p className="mt-6 t-small text-text-2" role="alert">{down}</p>}
      {total === 0 && !down && (
        <div className="trips-empty mt-8">
          <p className="t-h2">No shared trips yet</p>
          <p className="t-body text-text-2 mt-1">Be the first: open one of your trips and press Share.</p>
          <Link href="/trips/ideas" className="btn btn-secondary mt-4 press">See trip ideas</Link>
        </div>
      )}
      <ul className="shared-grid mt-6">
        {trips.map((t) => (
          <li key={t.id}>
            <SharedCard t={t} />
          </li>
        ))}
      </ul>
      {total !== null && trips.length < total && (
        <p className="text-center mt-8">
          <button type="button" className="btn btn-secondary press" disabled={busy} onClick={() => void load(trips.length)}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null} More trips</button>
        </p>
      )}
    </main>
  );
}

/** On a shared trip's page: like, plan it, copy its link, report it. */
export function SharedTripActions({ trip }: { trip: SharedTripCard }) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(trip.likes);
  const [mine, setMine] = useState(false);
  const [copied, setCopied] = useState(false);
  // The viewer's own like is known in the browser (the page itself is the same for everyone).
  useEffect(() => {
    sharedTripsGet<{ trip: SharedTripCard }>(`id=${trip.id}`)
      .then((r) => {
        setLiked(!!r.trip.liked);
        setLikes(r.trip.likes);
        setMine(!!r.trip.mine);
      })
      .catch(() => {});
  }, [trip.id]);
  const like = async () => {
    if (!(await requireMember())) return;
    setLiked((l) => !l);
    setLikes((n) => n + (liked ? -1 : 1));
    try {
      const r = await sharedTripsPost<{ liked: boolean; likes: number }>({ action: "like", id: trip.id });
      setLiked(r.liked);
      setLikes(r.likes);
    } catch (err) {
      setLiked(liked);
      setLikes(likes);
      toast({ title: err instanceof CommunityRequestError ? err.message : "That didn't work. Try again.", emoji: "⚠️" });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard not available
    }
  };
  const report = async () => {
    if (!(await requireMember())) return;
    if (!window.confirm("Report this trip? It's hidden once a few people report it.")) return;
    try {
      await sharedTripsPost({ action: "report", id: trip.id });
      toast({ title: "Thanks, we've noted it", emoji: "🚩" });
    } catch (err) {
      toast({ title: err instanceof CommunityRequestError ? err.message : "That didn't work. Try again.", emoji: "⚠️" });
    }
  };
  return (
    <div className="shared-actions">
      <Link href={sharedPlanHref(trip)} className="btn btn-primary press" onClick={() => void sharedTripsPost({ action: "use", id: trip.id }).catch(() => {})}>
        Make it my trip <ArrowRight size={16} aria-hidden />
      </Link>
      <button type="button" className="btn btn-secondary press" aria-pressed={liked} onClick={() => void like()} data-liked={liked || undefined}>
        <Heart size={16} aria-hidden fill={liked ? "currentColor" : "none"} className={liked ? "text-[#e5484d]" : ""} /> <span className="tnum">{likes}</span> <span className="sr-only">likes</span>
      </button>
      <button type="button" className="btn btn-secondary press" onClick={() => void copy()}>{copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} {copied ? "Copied" : "Copy link"}</button>
      {!mine && (
        <button type="button" className="btn btn-ghost btn-sm press ml-auto" onClick={() => void report()}><Flag size={14} aria-hidden /> Report</button>
      )}
    </div>
  );
}

/** Your trip, shared with everyone (or updated, or taken down). */
export function ShareTripDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(trip.name);
  const [about, setAbout] = useState("");
  const [withPlaces, setWithPlaces] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState<SharedTripCard | null>(null);
  const [copied, setCopied] = useState(false);
  const stops = trip.stops ?? [];
  useEffect(() => {
    ref.current?.showModal();
    // Already shared: what was said then.
    if (trip.sharedId)
      sharedTripsGet<{ trip: SharedTripCard }>(`id=${trip.sharedId}`)
        .then((r) => {
          if (!r.trip.mine) return;
          setShared(r.trip);
          setAbout(r.trip.about);
          setName(r.trip.name);
        })
        .catch(() => {});
  }, [trip.sharedId]);
  // What goes with each city: the places to see and eat there (titles only, never times or notes).
  const seeIn = (from: string, to: string, lat: number, lng: number) =>
    (trip.plans ?? [])
      .filter((p) => (p.kind === "visit" || p.kind === "meal" || p.kind === "activity") && (p.day ? p.day >= from && p.day <= to : p.lat != null && Math.abs(p.lat - lat) < 0.5 && Math.abs((p.lng ?? 0) - lng) < 0.7))
      .map((p) => p.title)
      .slice(0, 8);
  const payload = () => ({
    action: "share",
    id: shared?.id,
    name,
    emoji: trip.emoji ?? "✈️",
    about,
    month: trip.start ? Number(trip.start.slice(5, 7)) : undefined,
    stops: stops.map((s) => ({ name: s.name, cc: s.countryCode, lat: s.lat, lng: s.lng, nights: nightsBetween(s.from, s.to), cityId: s.cityId, see: withPlaces ? seeIn(s.from, s.to, s.lat, s.lng) : [] })),
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!(await requireMember())) return;
    setBusy(true);
    try {
      const r = await sharedTripsPost<{ trip: SharedTripCard }>(payload());
      setShared(r.trip);
      userActions.updateTrip(trip.id, { sharedId: r.trip.id });
      toast({ title: shared ? "Shared trip updated" : "Your trip is shared", body: "Others can see it, like it and plan theirs from it.", emoji: "🌍", celebrate: !shared });
    } catch (err) {
      setError(err instanceof CommunityRequestError ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const unshare = async () => {
    if (!shared || !window.confirm("Take this trip down? Its likes go with it.")) return;
    setBusy(true);
    try {
      await sharedTripsPost({ action: "unshare", id: shared.id });
      userActions.updateTrip(trip.id, { sharedId: undefined });
      setShared(null);
      toast({ title: "Taken down", emoji: "🗑️" });
      onClose();
    } catch (err) {
      setError(err instanceof CommunityRequestError ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const link = shared ? `${typeof window !== "undefined" ? window.location.origin : ""}/trips/s/${shared.id}` : "";
  const places = stops.reduce((n, s) => n + seeIn(s.from, s.to, s.lat, s.lng).length, 0);
  return (
    <dialog
      ref={ref}
      aria-labelledby="share-trip-h"
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => e.target === ref.current && onClose()}
      className="dialog-backdrop m-auto w-[min(520px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[var(--radius-l)] bg-panel p-0 text-text shadow-2xl backdrop:bg-[rgb(13_27_51_/_0.45)] backdrop:backdrop-blur-sm"
    >
      <form onSubmit={(e) => void submit(e)} className="panel-in p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="share-trip-h" className="t-h2">{shared ? "Your shared trip" : "Share with travellers"}</h2>
            <p className="t-small text-text-2 mt-1">Everyone can see the route, the nights and the places to see, and plan their own trip from it. Your dates, times, bookings and notes stay private.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon -mr-2 -mt-1" aria-label="Close" onClick={onClose}><X size={18} aria-hidden /></button>
        </div>
        <div className="share-preview mt-4">
          <RouteSketch stops={stops} />
          <p className="text-sm font-semibold truncate"><span aria-hidden>{trip.emoji ?? "✈️"}</span> {name || "Your trip"}</p>
          <p className="t-micro text-text-2 truncate">{stops.map((s) => `${s.name} ${nightsBetween(s.from, s.to)}n`).join(" → ")}</p>
        </div>
        <label className="block mt-4">
          <span className="label">Name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required minLength={3} />
        </label>
        <label className="block mt-3">
          <span className="label">A few words <span className="text-text-3 font-normal">(optional)</span></span>
          <textarea className="field min-h-[5.5rem]" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={600} placeholder="What made it great, the best time to go, a tip for others…" />
        </label>
        <label className="mt-3 flex items-start gap-2 t-small">
          <input type="checkbox" className="mt-1" checked={withPlaces} onChange={(e) => setWithPlaces(e.target.checked)} />
          <span>Include the places to see and eat in each city{places ? ` (${places})` : ""}: names only.</span>
        </label>
        {error && <p className="mt-3 t-small text-bad" role="alert">{error}</p>}
        {shared && (
          <div className="share-link mt-4">
            <span className="truncate t-small">{link.replace(/^https?:\/\//, "")}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm shrink-0"
              onClick={() =>
                void navigator.clipboard
                  .writeText(link)
                  .then(() => (setCopied(true), window.setTimeout(() => setCopied(false), 1800)))
                  .catch(() => {})
              }
            >
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? "Copied" : "Copy"}
            </button>
            <Link href={`/trips/s/${shared.id}`} className="btn btn-ghost btn-sm shrink-0">Open</Link>
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-primary press" disabled={busy || stops.length === 0}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Share2 size={16} aria-hidden />} {shared ? "Update" : "Share it"}
          </button>
          <button type="button" className="btn btn-ghost press" onClick={onClose}>{shared ? "Done" : "Not now"}</button>
          {shared && <button type="button" className="btn btn-ghost btn-sm ml-auto text-bad press" onClick={() => void unshare()} disabled={busy}>Take it down</button>}
        </div>
      </form>
    </dialog>
  );
}
