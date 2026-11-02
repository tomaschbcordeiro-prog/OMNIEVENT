"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarHeart, Check, Crown, Info, Lock, LogOut, MapPin, MessageCircle, MoreHorizontal, Search, Settings, Share2, Trash2, UserPlus, Users } from "lucide-react";
import type { ClubPage, ClubPick, ClubRole, PublicProfile } from "@/lib/community/types";
import type { EventCard } from "@/lib/types";
import { ago, clubsGet, clubsPost, refreshMe, useMe } from "@/lib/community/client";
import { cardWhen } from "@/lib/format";
import { toast } from "../toast";
import { Poster } from "../ui";
import { Avatar, Burst, MemberName, requireMember } from "../community/bits";
import { CommunityPanel } from "../community/community-panel";
import { ClubCrest, RoleBadge, clubGradient, vibeEmoji, vibeLabel } from "./bits";
import { ClubForm } from "./club-form";

type Tab = "wall" | "picks" | "members" | "about" | "manage";

export function ClubView({ slug }: { slug: string }) {
  const { profile } = useMe();
  const router = useRouter();
  const [page, setPage] = useState<ClubPage | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState("");
  const [tab, setTab] = useState<Tab>("wall");
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0);

  const load = useCallback(async () => {
    try {
      setPage(await clubsGet<ClubPage>(`slug=${encodeURIComponent(slug)}`));
      setFailed("");
    } catch (err) {
      if ((err as { status?: number }).status === 404) setMissing(true);
      else setFailed(err instanceof Error ? err.message : "Couldn't load the club.");
    }
  }, [slug]);
  useEffect(() => {
    void load();
  }, [load, profile?.id]);

  /** Runs a club action, reports what went wrong, and reloads the page. */
  const run = async (body: Record<string, unknown>, done?: string, emoji = "✨") => {
    if (!page) return false;
    if (!(await requireMember(!!profile))) return false;
    setBusy(true);
    try {
      await clubsPost({ club: page.club.id, ...body });
      if (done) toast({ title: done, emoji });
      await load();
      return true;
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Something went wrong", emoji: "⚠️" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (missing)
    return (
      <main id="main" className="mx-auto max-w-3xl px-4 sm:px-6 py-16 text-center">
        <p className="text-5xl" aria-hidden>🫥</p>
        <h1 className="t-h1 mt-3">This club isn&apos;t here</h1>
        <p className="t-body text-text-2 mt-2">It may have closed, or the link is mistyped.</p>
        <Link href="/clubs" className="btn btn-gold mt-6">See all clubs</Link>
      </main>
    );
  if (!page)
    return (
      <main id="main">
        <div className="skeleton h-72 rounded-none" aria-hidden />
        {failed && <p role="alert" className="mx-auto max-w-3xl px-4 py-6 t-small text-bad">{failed}</p>}
      </main>
    );

  const { club } = page;
  const role = club.myRole;
  const admin = role === "owner" || role === "admin";
  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "wall", label: "Wall", icon: <MessageCircle size={15} aria-hidden /> },
    { id: "picks", label: "Picks", icon: <CalendarHeart size={15} aria-hidden />, count: page.inside ? page.picks.length : undefined },
    { id: "members", label: "Members", icon: <Users size={15} aria-hidden />, count: club.members },
    { id: "about", label: "About", icon: <Info size={15} aria-hidden /> },
    ...(admin ? [{ id: "manage" as Tab, label: "Manage", icon: <Settings size={15} aria-hidden />, count: page.requests.length || undefined }] : []),
  ];

  const join = async () => {
    const ok = await run({ action: "join" });
    if (!ok) return;
    if (club.privacy === "open") {
      setBurst((b) => b + 1);
      toast({ title: `Welcome to ${club.name}!`, emoji: club.emoji, body: "Say hi on the wall, or share an event you'd go to." });
    } else toast({ title: "Request sent", emoji: "📨", body: "The club's admins will let you in." });
  };
  const share = async () => {
    const url = `${location.origin}/clubs/${club.slug}`;
    const text = `Join ${club.name} on OMNIEVENT ${club.emoji} ${club.tagline}`;
    try {
      if (navigator.share) await navigator.share({ title: club.name, text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast({ title: "Invite link copied", emoji: "🔗", body: "Paste it to your friends." });
      }
    } catch {
      // share sheet closed
    }
  };

  return (
    <main id="main">
      {/* ---- Banner ---- */}
      <section className="relative overflow-hidden text-white" style={{ background: clubGradient(club.hue, 120) }}>
        <span className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(rgb(255 255 255 / 0.55) 1px, transparent 1px)", backgroundSize: "18px 18px" }} aria-hidden />
        <span className="absolute -right-10 -top-16 text-[220px] leading-none opacity-15 select-none" aria-hidden>{club.emoji}</span>
        <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6 pt-8 pb-7">
          <Link href="/clubs" className="t-small text-white/85 hover:text-white">✦ Clubs</Link>
          <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end">
            <ClubCrest club={club} size={104} />
            <div className="min-w-0 flex-1">
              <h1 className="t-h1 !text-white break-words drop-shadow-[0_2px_10px_rgb(0_0_0_/_0.25)]">{club.name}</h1>
              <p className="t-lede text-white/90 mt-1">{club.tagline}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {club.city && <Chip><MapPin size={12} aria-hidden /> {club.city}</Chip>}
                <Chip>{club.privacy === "open" ? <><Users size={12} aria-hidden /> Open to all</> : <><Lock size={12} aria-hidden /> By request</>}</Chip>
                {club.vibes.map((v) => <Chip key={v}>{vibeEmoji(v)} {vibeLabel(v)}</Chip>)}
                {club.tags.map((t) => <Chip key={t}>#{t}</Chip>)}
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="relative">
              {!role && !club.requested && (
                <button type="button" className="btn btn-gold press" disabled={busy} onClick={() => void join()}>
                  {club.privacy === "open" ? <><UserPlus size={17} aria-hidden /> Join the club</> : <><Lock size={16} aria-hidden /> Ask to join</>}
                </button>
              )}
              {!role && club.requested && (
                <button type="button" className="btn press border border-white/40 bg-white/15 text-white" disabled={busy} onClick={() => void run({ action: "leave" }, "Request withdrawn", "👌")}>
                  <Check size={16} aria-hidden /> Request sent · withdraw
                </button>
              )}
              {role && <span className="inline-flex"><RoleBadge role={role} className="!text-sm !px-3 !py-1.5" /></span>}
              {burst > 0 && <Burst key={burst} />}
            </div>
            <button type="button" className="btn press border border-white/40 bg-white/15 text-white hover:bg-white/25" onClick={() => void share()}>
              <Share2 size={16} aria-hidden /> Invite friends
            </button>
            <span className="flex items-center gap-2 ml-auto">
              {club.faces.length > 0 && <span className="avatar-stack flex">{club.faces.map((p) => <Avatar key={p.id} p={p} size={30} />)}</span>}
              <span className="t-small font-semibold tnum">{club.members} {club.members === 1 ? "member" : "members"}</span>
            </span>
          </div>
        </div>
      </section>

      {/* ---- Tabs ---- */}
      <div className="sticky top-[var(--header-h)] z-20 border-b border-line bg-bg/90 backdrop-blur-md">
        <div role="tablist" aria-label="Club" className="mx-auto max-w-[1200px] px-4 sm:px-6 flex gap-1 overflow-x-auto no-scrollbar">
          {tabs.map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`relative flex shrink-0 items-center gap-1.5 px-3 py-3 t-small font-semibold ${tab === t.id ? "text-text" : "text-text-2 hover:text-text"}`}>
              {t.icon} {t.label}
              {t.count ? <span className={`tnum rounded-full px-1.5 text-[11px] ${t.id === "manage" ? "bg-coral text-white" : "bg-panel-2"}`}>{t.count}</span> : null}
              {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full" style={{ background: clubGradient(club.hue, 90) }} aria-hidden />}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-8">
        {tab === "wall" &&
          (page.inside ? (
            <CommunityPanel
              target={`k:${club.id}`}
              mode="club"
              title={club.name}
              heading="Wall"
              locked={
                role ? undefined : (
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-l)] border border-dashed border-line-strong p-4">
                    <p className="t-small text-text-2 flex-1">Join the club to post, react and plan meet-ups with its members.</p>
                    <button type="button" className="btn btn-gold btn-sm press" onClick={() => void join()}><UserPlus size={15} aria-hidden /> Join</button>
                  </div>
                )
              }
              onModerate={admin ? (post) => run({ action: "unpost", post }, "Post removed", "🧹") : undefined}
            />
          ) : (
            <MembersOnly requested={!!club.requested} onAsk={() => void join()} />
          ))}
        {tab === "picks" && (page.inside ? <Picks page={page} run={run} me={profile} /> : <MembersOnly requested={!!club.requested} onAsk={() => void join()} />)}
        {tab === "members" && (page.inside ? <Members page={page} run={run} me={profile} /> : <MembersOnly requested={!!club.requested} onAsk={() => void join()} />)}
        {tab === "about" && <About page={page} />}
        {tab === "manage" && admin && <Manage page={page} run={run} me={profile} onSaved={() => void load()} onDeleted={() => router.push("/clubs")} />}

        {role && role !== "owner" && tab !== "manage" && (
          <p className="mt-10 t-small text-text-3">
            <button type="button" className="inline-flex items-center gap-1 hover:text-bad" onClick={() => confirm(`Leave ${club.name}?`) && void run({ action: "leave" }, "You left the club", "👋")}>
              <LogOut size={14} aria-hidden /> Leave the club
            </button>
          </p>
        )}
      </div>
    </main>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-black/25 px-2.5 py-1 t-micro font-semibold text-white backdrop-blur-sm">{children}</span>;
}

function MembersOnly({ requested, onAsk }: { requested: boolean; onAsk: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-[var(--radius-l)] border border-line bg-panel p-8 text-center">
      <p className="text-4xl" aria-hidden>🔒</p>
      <p className="t-h3 mt-2">For members only</p>
      <p className="t-small text-text-2 mt-1">This club&apos;s wall, members and shared events are private. Ask to join and an admin will let you in.</p>
      {requested ? <p className="mt-4 t-small font-semibold text-ok">✓ Your request is waiting for an admin</p> : <button type="button" className="btn btn-gold mt-4 press" onClick={onAsk}><Lock size={15} aria-hidden /> Ask to join</button>}
    </div>
  );
}

type Run = (body: Record<string, unknown>, done?: string, emoji?: string) => Promise<boolean>;

// ---- Picks: events shared with the club, and votes ------------------------------------------

function Picks({ page, run, me }: { page: ClubPage; run: Run; me: PublicProfile | null }) {
  const { club } = page;
  const role = club.myRole;
  const [q, setQ] = useState("");
  const [found, setFound] = useState<EventCard[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [votes, setVotes] = useState<Record<string, { votes: number; voted: boolean }>>({});

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setFound(null);
    setSearching(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const p = new URLSearchParams({ q: term, size: "6", from: new Date().toISOString().slice(0, 10) });
      if (club.cityId) p.set("city", club.cityId);
      fetch(`/api/events?${p}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((j: { items?: EventCard[] }) => setFound(j.items ?? []))
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 300);
    return () => (clearTimeout(t), ctrl.abort());
  }, [q, club.cityId]);

  const vote = async (p: ClubPick) => {
    if (!role) return;
    const cur = votes[p.id] ?? { votes: p.votes, voted: p.voted };
    setVotes((v) => ({ ...v, [p.id]: { votes: cur.votes + (cur.voted ? -1 : 1), voted: !cur.voted } }));
    try {
      const r = await clubsPost<{ votes: number; voted: boolean }>({ action: "vote", club: club.id, event: p.id });
      setVotes((v) => ({ ...v, [p.id]: r }));
    } catch (err) {
      setVotes((v) => ({ ...v, [p.id]: cur }));
      toast({ title: err instanceof Error ? err.message : "Something went wrong", emoji: "⚠️" });
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px] lg:items-start">
      <section aria-labelledby="picks-h">
        <h2 id="picks-h" className="t-h2">What we&apos;d go to</h2>
        <p className="t-small text-text-2 mt-1">Events members shared. Vote for the ones you&apos;d go to: the most wanted rise to the top.</p>
        {page.picks.length === 0 ? (
          <div className="mt-4 rounded-[var(--radius-l)] border border-dashed border-line-strong p-6 text-center">
            <p className="text-3xl" aria-hidden>🎟️</p>
            <p className="font-semibold mt-1">Nothing shared yet</p>
            <p className="t-small text-text-2 mt-0.5">{role ? "Find an event on the right, or use “Share with a club” on any event page." : "Members share events here."}</p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3">
            {page.picks.map((p, i) => {
              const v = votes[p.id] ?? { votes: p.votes, voted: p.voted };
              const by = page.profiles[p.by];
              return (
                <li key={p.id} className="surface flex gap-3 rounded-[var(--radius-l)] p-3">
                  <Link href={`/events/${p.slug}`} className="shrink-0">
                    <Poster title={p.title} imageUrl={p.imageUrl} hue={p.hue} categorySlug={p.categorySlug} size="sm" className="h-20 w-20 rounded-[var(--radius-m)]" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    {i === 0 && v.votes > 1 && <p className="t-micro font-bold text-[#8a5200]">🏆 Most wanted</p>}
                    <Link href={`/events/${p.slug}`} className="block font-semibold leading-tight hover:text-cyan line-clamp-2">{p.title}</Link>
                    <p className="t-micro text-text-3 mt-0.5 truncate">{vibeEmoji(p.groupSlug)} {cardWhen({ ...p, eventType: p.until ? "multi_day" : "single" })} · {p.venueName}{p.city ? `, ${p.city}` : ""}</p>
                    <p className="t-micro text-text-3 mt-0.5">Shared by {by?.firstName ?? by?.name ?? "a member"} · {ago(p.at)}</p>
                  </div>
                  <div className="flex flex-col items-end justify-between gap-2">
                    <button type="button" aria-pressed={v.voted} disabled={!role} onClick={() => void vote(p)} className={`btn btn-sm press ${v.voted ? "bg-sun text-text border-sun" : "btn-secondary"}`} title={role ? undefined : "Join to vote"}>
                      🙋 <span className="tnum">{v.votes}</span> <span className="max-sm:hidden">{v.voted ? "You'd go" : "I'd go"}</span>
                    </button>
                    {(p.by === me?.id || role === "owner" || role === "admin") && (
                      <button type="button" className="t-micro text-text-3 hover:text-bad" onClick={() => void run({ action: "unpick", event: p.id }, "Removed from picks", "🗑️")}>Remove</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {role && (
        <aside className="surface rounded-[var(--radius-l)] p-4 lg:sticky lg:top-[calc(var(--header-h)+4.5rem)]" aria-labelledby="share-h">
          <h3 id="share-h" className="t-h3">Share an event</h3>
          <p className="t-micro text-text-3 mt-0.5">{club.city ? `Searching in ${club.city}.` : "Search any event coming up."}</p>
          <label className="relative mt-3 block">
            <span className="sr-only">Search events to share</span>
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" aria-hidden />
            <input className="field w-full pl-9" placeholder="Artist, venue, show…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {searching && <div className="skeleton h-14 mt-3" aria-hidden />}
          {found && !searching && found.length === 0 && <p className="t-small text-text-2 mt-3">Nothing found. Try other words.</p>}
          {found && found.length > 0 && (
            <ul className="mt-3 grid gap-1.5">
              {found.map((c) => {
                const shared = page.picks.some((p) => p.id === c.id);
                return (
                  <li key={c.id} className="flex items-center gap-2.5 rounded-[var(--radius-m)] p-1.5 hover:bg-panel-2">
                    <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} size="sm" className="h-11 w-11 rounded-[var(--radius-s)] shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block t-small font-semibold truncate">{c.title}</span>
                      <span className="block t-micro text-text-3 truncate">{cardWhen(c)} · {c.city}</span>
                    </span>
                    <button type="button" disabled={shared} className="btn btn-sm btn-secondary press" onClick={async () => { if (await run({ action: "pick", event: c.id }, "Shared with the club", "🎟️")) setQ(""); }}>
                      {shared ? "Shared" : "Share"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}

// ---- Members ---------------------------------------------------------------------------------

function Members({ page, run, me }: { page: ClubPage; run: Run; me: PublicProfile | null }) {
  const myRole = page.club.myRole;
  return (
    <section aria-labelledby="members-h">
      <h2 id="members-h" className="t-h2">Members</h2>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {page.members.map((m) => (
          <li key={m.profile.id} className="surface flex items-center gap-3 rounded-[var(--radius-l)] p-3">
            <Avatar p={m.profile} size={40} />
            <div className="min-w-0 flex-1">
              <MemberName p={m.profile} className="t-small truncate" />
              <p className="t-micro text-text-3">{m.since ? `Since ${new Date(m.since).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : ""}</p>
            </div>
            {m.role !== "member" && <RoleBadge role={m.role} />}
            {m.profile.id !== me?.id && <MemberMenu role={m.role} myRole={myRole} name={m.profile.firstName ?? m.profile.name} onAct={(body, done, emoji) => run({ member: m.profile.id, ...body }, done, emoji)} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MemberMenu({ role, myRole, name, onAct }: { role: ClubRole; myRole?: ClubRole; name: string; onAct: Run }) {
  const [open, setOpen] = useState(false);
  const owner = myRole === "owner";
  const canRemove = owner ? role !== "owner" : myRole === "admin" && role === "member";
  if (!owner && !canRemove) return null;
  const item = "w-full text-left rounded px-2.5 py-2 t-small hover:bg-panel-2";
  return (
    <div className="relative">
      <button type="button" className="btn btn-ghost btn-icon h-8 w-8" aria-label={`Manage ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-60 surface-float rounded-[var(--radius-m)] p-1 panel-in" onMouseLeave={() => setOpen(false)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          {owner && role === "member" && <button role="menuitem" type="button" className={item} onClick={() => (setOpen(false), void onAct({ action: "role", role: "admin" }, `${name} is now an admin`, "⭐"))}>⭐ Make admin</button>}
          {owner && role === "admin" && <button role="menuitem" type="button" className={item} onClick={() => (setOpen(false), void onAct({ action: "role", role: "member" }, `${name} is a member again`, "👌"))}>Remove admin role</button>}
          {owner && role !== "owner" && (
            <button role="menuitem" type="button" className={item} onClick={() => { setOpen(false); if (confirm(`Make ${name} the owner? You'll stay on as an admin.`)) void onAct({ action: "transfer" }, `${name} owns the club now`, "👑"); }}>👑 Make owner</button>
          )}
          {canRemove && (
            <>
              <button role="menuitem" type="button" className={`${item} text-bad`} onClick={() => { setOpen(false); if (confirm(`Remove ${name} from the club? They can ask to join again.`)) void onAct({ action: "remove" }, `${name} was removed`, "👋"); }}>Remove from club</button>
              <button role="menuitem" type="button" className={`${item} text-bad`} onClick={() => { setOpen(false); if (confirm(`Remove ${name} and keep them out for good?`)) void onAct({ action: "remove", ban: true }, `${name} was removed and can't rejoin`, "🚫"); }}>Remove and keep out</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- About -----------------------------------------------------------------------------------

function About({ page }: { page: ClubPage }) {
  const { club } = page;
  const owner = page.members.find((m) => m.role === "owner")?.profile ?? page.profiles[club.owner];
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section aria-labelledby="about-h">
        <h2 id="about-h" className="t-h2">About {club.name}</h2>
        <p className="t-body mt-3 whitespace-pre-line measure">{club.about || club.tagline}</p>
        <p className="t-small text-text-3 mt-4">
          Founded {new Date(club.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
          {owner ? <> · run by <Link href={`/community/u/${owner.username ?? owner.id}`} className="font-semibold text-text hover:text-cyan">{owner.name}</Link></> : null}
        </p>
      </section>
      <section aria-labelledby="taste-h" className="surface rounded-[var(--radius-l)] p-5">
        <h2 id="taste-h" className="t-h3">The club&apos;s taste</h2>
        <p className="t-micro text-text-3 mt-0.5">From what the club is into and the events members share.</p>
        {page.taste.length === 0 ? (
          <p className="t-small text-text-2 mt-3">Share a few events to find out.</p>
        ) : (
          <ul className="mt-3 grid gap-2.5">
            {page.taste.map((t) => (
              <li key={t.group}>
                <div className="flex justify-between t-small"><span>{vibeEmoji(t.group)} {vibeLabel(t.group)}</span><span className="tnum text-text-3">{t.share}%</span></div>
                <div className="mt-1 h-2 rounded-full bg-panel-2 overflow-hidden">
                  <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${t.share}%`, background: clubGradient(club.hue, 90) }} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {club.tags.length > 0 && <div className="mt-4 flex flex-wrap gap-1">{club.tags.map((t) => <span key={t} className="rounded-full bg-sun/20 px-2 py-0.5 t-micro">#{t}</span>)}</div>}
      </section>
    </div>
  );
}

// ---- Manage (owners and admins) ----------------------------------------------------------------

function Manage({ page, run, me, onSaved, onDeleted }: { page: ClubPage; run: Run; me: PublicProfile | null; onSaved: () => void; onDeleted: () => void }) {
  const { club } = page;
  const owner = club.myRole === "owner";
  const [editing, setEditing] = useState(false);
  return (
    <div className="grid gap-10">
      <section aria-labelledby="req-h">
        <h2 id="req-h" className="t-h2">Join requests</h2>
        {page.requests.length === 0 ? (
          <p className="t-small text-text-2 mt-2">{club.privacy === "open" ? "Anyone can join this club, so there's nothing to approve." : "No one is waiting. Share the club's link to invite people."}</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {page.requests.map((r) => (
              <li key={r.profile.id} className="surface flex items-center gap-3 rounded-[var(--radius-l)] p-3">
                <Avatar p={r.profile} size={40} />
                <div className="min-w-0 flex-1">
                  <MemberName p={r.profile} className="t-small truncate" />
                  <p className="t-micro text-text-3">Asked {ago(r.at)}</p>
                </div>
                <button type="button" className="btn btn-sm btn-gold press" onClick={() => void run({ action: "accept", member: r.profile.id }, `${r.profile.firstName ?? r.profile.name} is in!`, "🎉")}>Let in</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void run({ action: "decline", member: r.profile.id }, "Request declined", "👌")}>Decline</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="edit-h">
        <div className="flex items-center justify-between gap-3">
          <h2 id="edit-h" className="t-h2">Club details</h2>
          {!editing && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}><Settings size={15} aria-hidden /> Edit</button>}
        </div>
        {editing ? (
          <div className="mt-4">
            <ClubForm club={club} onSaved={() => (setEditing(false), onSaved())} onCancel={() => setEditing(false)} />
          </div>
        ) : (
          <p className="t-small text-text-2 mt-2">Name, crest, colours, what the club is into, city, who can join and the description.</p>
        )}
      </section>

      {owner && (
        <section aria-labelledby="danger-h" className="rounded-[var(--radius-l)] border border-bad/30 p-5">
          <h2 id="danger-h" className="t-h3 text-bad">Close the club</h2>
          <p className="t-small text-text-2 mt-1">Closing removes the club, its members list and its picks for good. To leave without closing it, make another member the owner from the Members tab.</p>
          <button
            type="button"
            className="btn btn-secondary text-bad mt-3"
            onClick={async () => {
              const typed = prompt(`Type the club's name to close it for good:\n${club.name}`);
              if (typed?.trim() !== club.name) return;
              if (await run({ action: "delete" }, "Club closed", "🗝️")) {
                await refreshMe();
                onDeleted();
              }
            }}
          >
            <Trash2 size={15} aria-hidden /> Close {club.name}
          </button>
        </section>
      )}
      {!owner && me && <p className="t-small text-text-3"><Crown size={13} className="inline -mt-0.5" aria-hidden /> Only the owner can close the club or name admins.</p>}
    </div>
  );
}
