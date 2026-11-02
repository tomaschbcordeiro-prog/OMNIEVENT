"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Crown, Lock, Users, X } from "lucide-react";
import { CLUB_EMOJIS, type Club, type ClubCard, type ClubPrivacy } from "@/lib/community/types";
import { safetyProblem } from "@/lib/community/safety";
import { GROUPS } from "@/lib/categories";
import { CITIES } from "@/lib/destinations";
import { clubsPost, refreshMe, useMe } from "@/lib/community/client";
import { toast } from "../toast";
import { Burst, requireMember } from "../community/bits";
import { ClubCrest, clubGradient, vibeEmoji, vibeLabel } from "./bits";

const VIBES = GROUPS.filter((g) => g.slug !== "other").map((g) => g.slug);
const SWATCHES = [270, 320, 350, 20, 40, 140, 175, 200, 225];
const cities = [...CITIES].sort((a, b) => a.name.localeCompare(b.name));

type Fields = { name: string; tagline: string; about: string; emoji: string; hue: number; vibes: string[]; tags: string[]; cityId: string; privacy: ClubPrivacy };

/** Founding a club, or (with `club`) editing it. A live preview shows how it will look. */
export function ClubForm({ club, onSaved, onCancel }: { club?: Club; onSaved?: (c: Club) => void; onCancel?: () => void }) {
  const router = useRouter();
  const sp = useSearchParams();
  const { profile } = useMe();
  const [f, setF] = useState<Fields>(() =>
    club
      ? { name: club.name, tagline: club.tagline, about: club.about ?? "", emoji: club.emoji, hue: club.hue, vibes: club.vibes, tags: club.tags, cityId: club.cityId ?? "", privacy: club.privacy }
      : {
          name: sp.get("name") ?? "",
          tagline: sp.get("tagline") ?? "",
          about: "",
          emoji: CLUB_EMOJIS.includes(sp.get("emoji") ?? "") ? sp.get("emoji")! : "✨",
          hue: Number(sp.get("hue")) || 270,
          vibes: (sp.get("vibes") ?? "").split(",").filter((v) => VIBES.includes(v)),
          tags: [],
          cityId: sp.get("city") ?? "",
          privacy: "open",
        },
  );
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [burst, setBurst] = useState(0);
  const set = (patch: Partial<Fields>) => setF((x) => ({ ...x, ...patch }));

  const warn = useMemo(() => safetyProblem(`${f.name}\n${f.tagline}\n${f.about}\n${f.tags.join(" ")}`), [f.name, f.tagline, f.about, f.tags]);
  const ready = f.name.trim().length >= 3 && f.tagline.trim().length >= 3 && !warn;
  const city = cities.find((c) => c.id === f.cityId);

  const addTag = () => {
    const t = tag.toLowerCase().replace(/[^\p{L}\p{N} &'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
    if (t.length >= 2 && !f.tags.includes(t) && f.tags.length < 6) set({ tags: [...f.tags, t] });
    setTag("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    if (!(await requireMember(!!profile))) return;
    setBusy(true);
    setError("");
    try {
      const body = { ...f, cityId: f.cityId || null };
      if (club) {
        const r = await clubsPost<{ club: Club }>({ action: "update", club: club.id, ...body });
        toast({ title: "Club updated", emoji: "✨" });
        onSaved?.(r.club);
      } else {
        const r = await clubsPost<{ club: Club }>({ action: "create", ...body });
        setBurst((b) => b + 1);
        await refreshMe();
        toast({ celebrate: true, emoji: "👑", title: `${r.club.name} is live!`, body: "You're its owner. Invite your friends and share your first event." });
        router.push(`/clubs/${r.club.slug}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const preview: ClubCard = { id: "preview", slug: "", owner: "", createdAt: "", members: 1, picks: 0, faces: profile ? [profile] : [], name: f.name || "Your club's name", tagline: f.tagline || "What it's about, in one line", emoji: f.emoji, hue: f.hue, vibes: f.vibes, tags: f.tags, city: city?.name, privacy: f.privacy };

  return (
    <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[1fr_340px] lg:items-start" noValidate>
      <div className="grid gap-6 min-w-0">
        <Field label="Name" hint={`${f.name.length}/40`}>
          <input className="field w-full" required minLength={3} maxLength={40} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Lisbon Jazz Nights" autoFocus={!club} />
        </Field>
        <Field label="In one line" hint={`${f.tagline.length}/90`}>
          <input className="field w-full" required minLength={3} maxLength={90} value={f.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="Small clubs, big solos, every week" />
        </Field>

        <fieldset>
          <legend className="t-small font-semibold">Crest</legend>
          <div className="mt-2 grid grid-cols-9 sm:grid-cols-12 gap-1.5">
            {CLUB_EMOJIS.map((e) => (
              <button key={e} type="button" aria-pressed={f.emoji === e} aria-label={`Crest ${e}`} onClick={() => set({ emoji: e })} className={`press grid aspect-square place-items-center rounded-[var(--radius-s)] text-xl transition ${f.emoji === e ? "ring-2 ring-[var(--gold)] bg-[var(--club-deep)]/10 scale-105" : "hover:bg-panel-2"}`}>
                {e}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="t-small font-semibold">Colours</legend>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {SWATCHES.map((h) => (
              <button key={h} type="button" aria-label={`Colour ${h}`} aria-pressed={f.hue === h} onClick={() => set({ hue: h })} className={`press h-9 w-9 rounded-full ${f.hue === h ? "ring-2 ring-offset-2 ring-[var(--gold)]" : ""}`} style={{ background: clubGradient(h) }} />
            ))}
            <label className="flex items-center gap-2 t-small text-text-2 ml-1">
              <span className="sr-only">Any colour</span>
              <input type="range" min={0} max={359} value={f.hue} onChange={(e) => set({ hue: Number(e.target.value) })} className="w-32 accent-[var(--club-deep)]" />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend className="t-small font-semibold">What you&apos;re into <span className="font-normal text-text-3">(up to 5)</span></legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {VIBES.map((v) => {
              const on = f.vibes.includes(v);
              return (
                <button key={v} type="button" aria-pressed={on} disabled={!on && f.vibes.length >= 5} onClick={() => set({ vibes: on ? f.vibes.filter((x) => x !== v) : [...f.vibes, v] })} className={`chip press ${on ? "!bg-[var(--club-deep)] !text-white !border-[var(--club-deep)]" : ""}`}>
                  <span aria-hidden>{vibeEmoji(v)}</span> {vibeLabel(v)}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Not a <label>: it holds buttons, and a click on a label would press the first one. */}
        <div>
          <span className="flex items-baseline justify-between gap-2">
            <span className="t-small font-semibold" id="tags-label">Your own words</span>
            <span className="t-micro text-text-3">Press Enter after each (up to 6), like “bebop” or “front row”</span>
          </span>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-[var(--radius-m)] border border-line bg-panel px-2 py-1.5 focus-within:border-cyan">
            {f.tags.map((t) => (
              <span key={t} className="chip-pop inline-flex items-center gap-1 rounded-full bg-sun/20 px-2 py-0.5 t-small">
                #{t}
                <button type="button" aria-label={`Remove ${t}`} className="rounded-full p-0.5 hover:bg-black/10" onClick={() => set({ tags: f.tags.filter((x) => x !== t) })}><X size={12} aria-hidden /></button>
              </span>
            ))}
            <input
              className="min-w-32 flex-1 bg-transparent py-1 text-base sm:text-sm outline-none"
              value={tag}
              maxLength={24}
              disabled={f.tags.length >= 6}
              onChange={(e) => setTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                } else if (e.key === "Backspace" && !tag && f.tags.length) set({ tags: f.tags.slice(0, -1) });
              }}
              onBlur={addTag}
              aria-labelledby="tags-label"
              placeholder={f.tags.length ? "" : "jazz, late shows…"}
            />
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="City" hint="Optional: leave it for a club anywhere">
            <select className="field w-full" value={f.cityId} onChange={(e) => set({ cityId: e.target.value })}>
              <option value="">Anywhere</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <fieldset>
            <legend className="t-small font-semibold">Who can join</legend>
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-[var(--radius-m)] bg-panel-2 p-1">
              {(["open", "request"] as const).map((p) => (
                <button key={p} type="button" aria-pressed={f.privacy === p} onClick={() => set({ privacy: p })} className={`flex items-center justify-center gap-1.5 rounded-[calc(var(--radius-m)-4px)] px-2 py-2 t-small font-semibold ${f.privacy === p ? "bg-panel shadow-sm text-text" : "text-text-2"}`}>
                  {p === "open" ? <Users size={14} aria-hidden /> : <Lock size={14} aria-hidden />} {p === "open" ? "Anyone" : "By request"}
                </button>
              ))}
            </div>
            <p className="t-micro text-text-3 mt-1.5">{f.privacy === "open" ? "Anyone can join and read the wall." : "People ask to join; you and your admins say yes. The wall and members are for members only."}</p>
          </fieldset>
        </div>

        <Field label="About" hint={`${f.about.length}/600 · optional`}>
          <textarea className="field w-full min-h-28 py-2" maxLength={600} value={f.about} onChange={(e) => set({ about: e.target.value })} placeholder="What you do together, how often, who it's for…" />
        </Field>

        {warn && <p role="alert" className="t-small text-bad">{warn}</p>}
        {error && <p role="alert" className="t-small text-bad">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <span className="relative">
            <button type="submit" className="btn btn-gold press" disabled={!ready || busy}>
              <Crown size={17} aria-hidden /> {club ? "Save changes" : busy ? "Founding…" : "Found the club"}
            </button>
            {burst > 0 && <Burst key={burst} />}
          </span>
          {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
          {!club && <p className="t-micro text-text-3">You&apos;ll be its owner. You can change everything later, except the address.</p>}
        </div>
      </div>

      <aside className="lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] order-first lg:order-none" aria-label="Preview">
        <p className="t-micro font-semibold uppercase tracking-wide text-text-3 mb-2">Preview</p>
        <div className="overflow-hidden rounded-[var(--radius-l)] border border-line bg-panel shadow-sm">
          <div className="club-shine relative h-24" style={{ background: clubGradient(preview.hue, 120) }}>
            <span className="absolute inset-0 opacity-25" style={{ backgroundImage: "radial-gradient(rgb(255 255 255 / 0.5) 1px, transparent 1px)", backgroundSize: "14px 14px" }} aria-hidden />
          </div>
          <div className="px-4 pb-4">
            <ClubCrest club={preview} size={64} className="-mt-8 relative" />
            <p className="mt-2 font-bold text-lg leading-tight break-words">{preview.name}</p>
            <p className="t-small text-text-2 mt-0.5 break-words">{preview.tagline}</p>
            <div className="mt-2.5 flex flex-wrap gap-1">
              {preview.vibes.map((v) => <span key={v} className="rounded-full bg-panel-2 px-2 py-0.5 t-micro text-text-2">{vibeEmoji(v)} {vibeLabel(v)}</span>)}
              {preview.tags.map((t) => <span key={t} className="rounded-full bg-sun/20 px-2 py-0.5 t-micro">#{t}</span>)}
              {preview.city && <span className="rounded-full bg-panel-2 px-2 py-0.5 t-micro text-text-2">📍 {preview.city}</span>}
              {preview.privacy === "request" && <span className="rounded-full bg-[var(--club-deep)]/10 px-2 py-0.5 t-micro text-[var(--club-deep)]">🔒 By request</span>}
            </div>
          </div>
        </div>
      </aside>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="t-small font-semibold">{label}</span>
        {hint && <span className="t-micro text-text-3">{hint}</span>}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
