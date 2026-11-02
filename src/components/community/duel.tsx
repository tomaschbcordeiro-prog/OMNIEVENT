"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Share2, Swords, Trophy } from "lucide-react";
import { BADGES, type Duel, type DuelPick, type DuelRound, type DuelSide } from "@/lib/community/types";
import { communityGet, communityPost, refreshMe, useMe } from "@/lib/community/client";
import { Poster, SaveButton } from "../ui";
import { toast } from "../toast";
import { Burst, requireMember } from "./bits";

/**
 * The daily duel: three rounds of "this or that" between events in today's city. Pick one
 * (tap, or ← and →), watch how everyone else picked, and keep a streak going day after day.
 */

const GROUP_EMOJI: Record<string, string> = {
  music: "🎶", sports: "🏟️", theatre: "🎭", comedy: "😂", festivals: "🎉", cinema: "🎬", conferences: "🎤", technology: "💻",
  exhibitions: "🖼️", attractions: "🎡", "food-drink": "🍷", nightlife: "🪩", family: "🧸", outdoor: "🥾", education: "📚", fashion: "👗", culture: "🏛️",
};
const emojiOf = (s: DuelSide) => GROUP_EMOJI[s.groupSlug] ?? "✨";

function when(s: DuelSide): string {
  const d = new Date(s.start);
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: s.timeZone }).format(d);
  return s.hoursUnknown ? day : `${day}, ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: s.timeZone }).format(d)}`;
}

/** The share of votes for the viewer's pick, 0–100. */
const share = (r: DuelRound) => {
  const total = (r.votes?.a ?? 0) + (r.votes?.b ?? 0);
  return total && r.mine ? Math.round(((r.votes?.[r.mine] ?? 0) / total) * 100) : 0;
};

function quip(r: DuelRound): string {
  const total = (r.votes?.a ?? 0) + (r.votes?.b ?? 0);
  const pct = share(r);
  if (total <= 1) return "You're the first to pick! 🥇 Come back later to see who agrees.";
  if (pct === 50) return "Dead heat! 🤝 Half the people agree with you.";
  if (pct >= 75) return `Crowd favourite! 🙌 ${pct}% picked it too.`;
  if (pct > 50) return `You're with the majority: ${pct}% agree. 👍`;
  if (pct >= 30) return `Close call: ${pct}% agree with you. 🤏`;
  return `Bold pick! 😎 Only ${pct}% went that way.`;
}

const votesIn = (r: DuelRound) => (r.votes?.a ?? 0) + (r.votes?.b ?? 0);

function verdict(rounds: DuelRound[]): { emoji: string; title: string; body: string } {
  if (rounds.every((r) => votesIn(r) <= 1)) return { emoji: "🥇", title: "Trailblazer", body: "You played before anyone else today. Come back later to see who agrees with you." };
  const withCrowd = rounds.filter((r) => share(r) > 50).length;
  if (withCrowd === rounds.length) return { emoji: "🎯", title: "Crowd whisperer", body: "You picked like everyone else, every single time." };
  if (rounds.every((r) => share(r) < 50 && (r.votes?.a ?? 0) + (r.votes?.b ?? 0) > 1)) return { emoji: "🦄", title: "Free spirit", body: "You went against the crowd in every round. Respect." };
  return { emoji: "⚖️", title: "Balanced taste", body: `With the crowd in ${withCrowd} of ${rounds.length} rounds, your own way in the rest.` };
}

/** Counts up to a number (instantly when motion is reduced). */
function useCountUp(target: number, run: boolean) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return setV(0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setV(target);
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return v;
}

function useCountdown(to: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  if (!to) return "";
  const ms = Math.max(0, Date.parse(to) - now);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function DailyDuel() {
  const { profile } = useMe();
  const [duel, setDuel] = useState<Duel | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0);
  const [said, setSaid] = useState("");
  // The last round's result stays on screen until "See my results".
  const [finished, setFinished] = useState(false);
  const nextRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await communityGet<{ duel: Duel | null }>("view=duel");
      setDuel(r.duel);
      setFailed(false);
      if (r.duel) {
        const open = r.duel.rounds.findIndex((x) => !x.mine);
        setRound(Math.max(0, open));
        setFinished(open === -1);
      }
    } catch {
      setFailed(true);
      setDuel(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, profile?.id]);

  const current = duel && !finished ? duel.rounds[round] : undefined;
  const countdown = useCountdown(duel?.nextAt);

  const pick = async (side: DuelPick) => {
    if (!duel || !current || current.mine || busy) return;
    setBusy(true);
    const firstToday = !duel.streak.playedToday;
    // Shown at once; the counts follow from the server.
    setDuel({ ...duel, rounds: duel.rounds.map((r, i) => (i === round ? { ...r, mine: side } : r)) });
    setBurst((b) => b + 1);
    try {
      const res = await communityPost<{ votes: { a: number; b: number }; mine: DuelPick; streak: Duel["streak"]; players: number }>({ action: "duel", day: duel.day, round, pick: side });
      const updated = { ...duel, players: res.players, streak: res.streak, rounds: duel.rounds.map((r, i) => (i === round ? { ...r, mine: res.mine, votes: res.votes } : r)) };
      setDuel(updated);
      const chosen = res.mine === "a" ? current.a : current.b;
      setSaid(`You picked ${chosen.title}. ${quip(updated.rounds[round])}`);
      if (firstToday && profile?.username) {
        const { before, after } = await refreshMe();
        if (before && after && after.karma > before.karma) toast({ title: `${res.streak.days > 1 ? `${res.streak.days}-day streak!` : "Duel played"}`, emoji: "⚔️", body: `+${after.karma - before.karma} point` });
        for (const b of after?.badges ?? [])
          if (before && !before.badges.includes(b) && BADGES[b]) toast({ celebrate: true, emoji: BADGES[b].emoji, title: `New badge: ${BADGES[b].label}`, body: BADGES[b].hint, href: `/community/u/${after!.id}`, linkLabel: "See it" });
      }
      requestAnimationFrame(() => nextRef.current?.focus());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: msg, emoji: "⚠️" });
      if (/new duel/i.test(msg)) void load();
      else setDuel(duel);
    } finally {
      setBusy(false);
    }
  };

  const shareIt = async () => {
    if (!duel) return;
    const picks = duel.rounds.map((r) => (r.mine === "a" ? r.a : r.b).title);
    const text = `I played today's OMNIEVENT duel in ${duel.city} ⚔️ My picks: ${picks.join(", ")}. What would you pick?`;
    const url = `${location.origin}/community#duel`;
    try {
      if (navigator.share) await navigator.share({ title: "Daily duel", text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast({ title: "Copied! Paste it to a friend", emoji: "📋" });
      }
    } catch {
      // the share sheet was closed
    }
  };

  if (duel === undefined) return <div className="skeleton h-80 rounded-[var(--radius-l)]" aria-hidden />;
  if (!duel)
    return failed ? (
      <section id="duel" className="rounded-[var(--radius-l)] border border-dashed border-line-strong p-5">
        <p className="t-h3 flex items-center gap-2"><Swords size={18} className="text-violet" aria-hidden /> Daily duel</p>
        <p className="t-small text-text-2 mt-1">Today&apos;s duel is taking a short break. Try again in a little while.</p>
      </section>
    ) : null;

  const r = current ?? duel.rounds[duel.rounds.length - 1];
  const revealed = !!r.mine;

  return (
    <section id="duel" aria-labelledby="duel-h" className="relative overflow-hidden rounded-[var(--radius-l)] border border-violet/25 bg-gradient-to-br from-violet/10 via-panel to-cyan/10 p-4 sm:p-5 scroll-mt-24">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="duel-h" className="t-h2 flex items-center gap-2"><Swords size={20} className="text-violet" aria-hidden /> Daily duel</h2>
        <span className="rounded-full bg-text px-2.5 py-0.5 t-micro font-semibold text-white">📍 {duel.city}</span>
        {duel.streak.days > 0 && (
          <span className="rounded-full bg-sun/20 px-2.5 py-0.5 t-micro font-semibold" title={`Best: ${duel.streak.best} days`}>
            <span className="flame" aria-hidden>🔥</span> {duel.streak.days}-day streak
          </span>
        )}
        <span className="ml-auto t-micro text-text-3 tnum">{duel.players > 0 ? `${duel.players} ${duel.players === 1 ? "person" : "people"} played today` : "Be the first to play today"}</span>
      </div>

      {!finished ? (
        <>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="t-small text-text-2">
              <span className="font-semibold text-text">Round {round + 1} of {duel.rounds.length}</span> · {emojiOf(r.a)} vs {emojiOf(r.b)} · which would you rather go to?
            </p>
            <ol className="flex gap-1.5" aria-hidden>
              {duel.rounds.map((x, i) => (
                <li key={i} className={`h-2 rounded-full transition-all ${i === round ? "w-6 bg-violet" : x.mine ? "w-2 bg-violet/60" : "w-2 bg-line-strong"}`} />
              ))}
            </ol>
          </div>

          <div
            key={round}
            className="duel-in relative mt-3 grid grid-cols-2 gap-3 sm:gap-5"
            onKeyDown={(e) => {
              const side = e.key === "ArrowLeft" ? "a" : e.key === "ArrowRight" ? "b" : undefined;
              if (!side || revealed) return;
              e.preventDefault();
              void pick(side);
            }}
          >
            {(["a", "b"] as const).map((k) => {
              const s = r[k];
              const state = !r.mine ? "open" : r.mine === k ? "won" : "lost";
              return (
                <button
                  key={k}
                  type="button"
                  data-side={k}
                  data-state={state}
                  disabled={revealed || busy}
                  aria-keyshortcuts={k === "a" ? "ArrowLeft" : "ArrowRight"}
                  aria-label={`Pick ${s.title}, ${when(s)} at ${s.venueName}`}
                  onClick={() => void pick(k)}
                  className="duel-side group relative block min-w-0 overflow-hidden rounded-[var(--radius-l)] bg-panel-2 text-left shadow-md disabled:cursor-default focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-violet"
                >
                  <Poster title={s.title} imageUrl={s.imageUrl} hue={s.hue} categorySlug={s.categorySlug} className="aspect-[4/5] sm:aspect-[4/3] w-full" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-3 pt-12 text-white">
                    <span className="t-micro font-semibold uppercase tracking-wide opacity-90">{emojiOf(s)} {s.isFree ? "Free · " : ""}{when(s)}</span>
                    <span className="mt-0.5 block font-bold leading-tight line-clamp-2 text-[0.95rem] sm:text-lg">{s.title}</span>
                    <span className="block t-micro opacity-85 truncate">{s.venueName}</span>
                  </span>
                  {state === "won" && (
                    <>
                      <span className="absolute right-2 top-2 rounded-full bg-sun px-2 py-0.5 t-micro font-bold text-text shadow pop">Your pick</span>
                      <Burst key={burst} />
                    </>
                  )}
                </button>
              );
            })}
            <span className="vs-badge pointer-events-none z-10 grid h-12 w-12 place-items-center rounded-full bg-text text-white font-black shadow-lg ring-4 ring-panel sm:h-14 sm:w-14 sm:text-lg" aria-hidden>
              VS
            </span>
          </div>

          <Result round={r} />
          <p className="sr-only" aria-live="polite">{said}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {revealed ? (
              <button
                ref={nextRef}
                type="button"
                className="btn btn-primary press"
                disabled={busy}
                onClick={() => {
                  const open = duel.rounds.findIndex((x) => !x.mine);
                  if (open === -1) setFinished(true);
                  else setRound(open);
                }}
              >
                {duel.rounds.filter((x) => !x.mine).length ? "Next round" : "See my results"} <ArrowRight size={16} aria-hidden />
              </button>
            ) : (
              <p className="t-micro text-text-3">Tap the one you&apos;d pick<span className="max-sm:hidden">, or use the ← → keys</span>. Results show after you choose.</p>
            )}
          </div>
        </>
      ) : (
        <Summary duel={duel} countdown={countdown} onShare={() => void shareIt()} member={!!profile?.username} />
      )}

      {duel.yesterday && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="t-micro font-semibold text-text-2 flex items-center gap-1.5"><Trophy size={13} className="text-amber" aria-hidden /> Yesterday&apos;s winners in {duel.yesterday.city}</p>
          <ul className="mt-1.5 flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {duel.yesterday.winners.map((w) => (
              <li key={w.id} className="shrink-0">
                <Link href={`/events/${w.slug}`} className="press flex max-w-64 items-center gap-2 rounded-full border border-line bg-panel py-1 pl-1 pr-3 hover:border-amber/50">
                  <Poster title={w.title} imageUrl={w.imageUrl} hue={w.hue} categorySlug={w.categorySlug} size="sm" className="h-7 w-7 rounded-full shrink-0" />
                  <span className="t-micro truncate"><strong className="tnum">{w.pct}%</strong> {w.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Result({ round }: { round: DuelRound }) {
  const total = (round.votes?.a ?? 0) + (round.votes?.b ?? 0);
  const a = total ? Math.round(((round.votes?.a ?? 0) / total) * 100) : 50;
  const shown = !!round.votes;
  const pa = useCountUp(a, shown);
  const pb = useCountUp(100 - a, shown);
  if (!round.mine) return null;
  return (
    <div className="mt-3 duel-in">
      <div className="duel-bar flex h-3 overflow-hidden rounded-full bg-panel-2" role="img" aria-label={shown ? `${a}% picked ${round.a.title}, ${100 - a}% picked ${round.b.title}` : "Counting the votes"}>
        <span className={`h-full ${round.mine === "a" ? "bg-violet" : "bg-violet/35"}`} style={{ width: shown ? `${a}%` : "50%" }} />
        <span className={`h-full ${round.mine === "b" ? "bg-cyan" : "bg-cyan/35"}`} style={{ width: shown ? `${100 - a}%` : "50%" }} />
      </div>
      <div className="mt-1 flex justify-between t-small font-bold tnum">
        <span className={round.mine === "a" ? "text-violet" : "text-text-3"}>{shown ? `${pa}%` : "…"}</span>
        <span className={round.mine === "b" ? "text-cyan" : "text-text-3"}>{shown ? `${pb}%` : "…"}</span>
      </div>
      {shown && <p className="t-small font-medium text-center mt-1">{quip(round)}</p>}
    </div>
  );
}

function Summary({ duel, countdown, onShare, member }: { duel: Duel; countdown: string; onShare: () => void; member: boolean }) {
  const v = verdict(duel.rounds);
  return (
    <div className="duel-in mt-3">
      <div className="flex items-start gap-3">
        <span className="text-4xl pop" aria-hidden>{v.emoji}</span>
        <div>
          <p className="t-h3">{v.title}</p>
          <p className="t-small text-text-2">{v.body}</p>
        </div>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {duel.rounds.map((r, i) => {
          const s = r.mine === "a" ? r.a : r.b;
          return (
            <li key={i} className="flex items-center gap-2.5 rounded-[var(--radius-m)] border border-line bg-panel p-2">
              <Poster title={s.title} imageUrl={s.imageUrl} hue={s.hue} categorySlug={s.categorySlug} size="sm" className="h-12 w-12 rounded-[var(--radius-s)] shrink-0" />
              <Link href={`/events/${s.slug}`} className="min-w-0 flex-1 hover:text-cyan">
                <span className="block t-small font-semibold truncate">{s.title}</span>
                <span className="block t-micro text-text-3 tnum">{votesIn(r) > 1 ? `${share(r)}% agree · ` : ""}{when(s)}</span>
              </Link>
              <SaveButton id={s.id} title={s.title} compact />
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary press" onClick={onShare}><Share2 size={16} aria-hidden /> Challenge a friend</button>
        <span className="t-small text-text-2">
          {duel.streak.days > 0 && <><span className="flame" aria-hidden>🔥</span> {duel.streak.days}-day streak{duel.streak.best > duel.streak.days ? ` (best ${duel.streak.best})` : ""} · </>}
          New duel in <strong className="tnum">{countdown}</strong>
        </span>
      </div>
      {!member && (
        <p className="mt-3 t-small text-text-2">
          <button type="button" className="font-semibold text-cyan hover:underline" onClick={() => void requireMember(false)}>Create an account</button> to keep your streak on every device, earn a point a day and the ⚔️ Duelist badge.
        </p>
      )}
    </div>
  );
}
