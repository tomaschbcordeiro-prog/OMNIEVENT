"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Shuffle, Star, X } from "lucide-react";
import { AVATARS, BADGES, suggestName, type Profile, type PublicProfile } from "@/lib/community/types";
import { communityPost, setMe, useMe } from "@/lib/community/client";
import { toast } from "../toast";

export function Avatar({ p, size = 36, className = "" }: { p?: Pick<Profile, "avatar" | "hue" | "name"> | null; size?: number; className?: string }) {
  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size, fontSize: size * 0.52, ["--h" as string]: p?.hue ?? 210 }} aria-hidden>
      {p?.avatar ?? "🙂"}
    </span>
  );
}

/** Name linked to the member's profile, with their highest badge. */
export function MemberName({ p, className = "" }: { p?: PublicProfile; className?: string }) {
  if (!p) return <span className={`text-text-3 ${className}`}>Former member</span>;
  const top = p.badges[p.badges.length - 1];
  return (
    <Link href={`/community/u/${p.id}`} className={`font-semibold hover:text-cyan ${className}`}>
      {p.name}
      {top && top !== "newcomer" && (
        <span className="ml-1" title={BADGES[top]?.label}>
          {BADGES[top]?.emoji}
        </span>
      )}
    </Link>
  );
}

export function Stars({ value, size = 14, className = "" }: { value: number; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-px ${className}`} role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i + 1));
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star size={size} className="absolute inset-0 text-line-strong" fill="currentColor" strokeWidth={0} aria-hidden />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star size={size} className="text-sun" fill="currentColor" strokeWidth={0} aria-hidden />
            </span>
          </span>
        );
      })}
    </span>
  );
}

const STAR_WORDS = ["", "Not for me", "It was OK", "Good", "Great", "Unforgettable"];

export function StarInput({ value, onChange, size = 28, label = "Your rating" }: { value: number; onChange: (n: number) => void; size?: number; label?: string }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center gap-2">
      <div role="radiogroup" aria-label={label} className="flex" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={`${i} star${i > 1 ? "s" : ""}: ${STAR_WORDS[i]}`}
            className="star-btn p-0.5 rounded"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(0)}
            onClick={() => onChange(i)}
          >
            <Star size={size} className={i <= shown ? "text-sun drop-shadow-[0_2px_4px_rgb(255_184_0_/_0.45)]" : "text-line-strong"} fill="currentColor" strokeWidth={0} aria-hidden />
          </button>
        ))}
      </div>
      <span className="t-small text-text-2 min-w-[7rem]" aria-live="polite">
        {STAR_WORDS[shown]}
      </span>
    </div>
  );
}

/** A quick confetti burst; mount it with a changing key to replay. */
export function Burst({ colors = ["#ffb800", "#1463ff", "#f0475a", "#0fa979", "#7b4dff"] }: { colors?: string[] }) {
  return (
    <span className="burst" aria-hidden>
      {Array.from({ length: 14 }, (_, i) => (
        <i key={i} style={{ ["--c" as string]: colors[i % colors.length], ["--r" as string]: `${(i * 360) / 14}deg`, ["--d" as string]: `${34 + (i % 3) * 12}px` }} />
      ))}
    </span>
  );
}

// ---- Joining -------------------------------------------------------------------------------

type JoinRequest = { resolve: (ok: boolean) => void; edit?: boolean };
let pending: JoinRequest | null = null;
const joinListeners = new Set<() => void>();
const emitJoin = () => joinListeners.forEach((l) => l());

/** Opens the join dialog when needed; resolves true once the visitor has a profile. */
export function requireMember(hasProfile: boolean, edit = false): Promise<boolean> {
  if (hasProfile && !edit) return Promise.resolve(true);
  return new Promise((resolve) => {
    pending?.resolve(false);
    pending = { resolve, edit };
    emitJoin();
  });
}

/** Mounted once in the layout: renders the join / edit-profile dialog on request. */
export function JoinHost() {
  const req = useSyncExternalStore(
    (l) => {
      joinListeners.add(l);
      return () => joinListeners.delete(l);
    },
    () => pending,
    () => null,
  );
  if (!req) return null;
  const close = (ok: boolean) => {
    pending = null;
    req.resolve(ok);
    emitJoin();
  };
  return <JoinDialog edit={!!req.edit} onClose={close} />;
}

const HUES = [210, 265, 330, 5, 28, 45, 95, 160, 190];

function JoinDialog({ edit, onClose }: { edit: boolean; onClose: (ok: boolean) => void }) {
  const { profile } = useMe();
  const [name, setName] = useState(profile?.name ?? suggestName());
  const [avatar, setAvatar] = useState(profile?.avatar ?? AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  const [hue, setHue] = useState(profile?.hue ?? HUES[Math.floor(Math.random() * HUES.length)]);
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await communityPost<{ profile: PublicProfile }>({ action: "profile", name, avatar, hue, bio });
      setMe(r.profile);
      if (!edit) toast({ celebrate: true, emoji: r.profile.avatar, title: `Welcome, ${r.profile.name}!`, body: "You earned the 🌱 Newcomer badge." });
      else toast({ title: "Profile saved", emoji: r.profile.avatar });
      onClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="join-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose(false);
      }}
      onClick={(e) => e.target === ref.current && onClose(false)}
      className="dialog-backdrop m-auto w-[min(440px,calc(100vw-32px))] rounded-[var(--radius-l)] bg-panel p-0 text-text shadow-2xl backdrop:bg-[rgb(13_27_51_/_0.45)] backdrop:backdrop-blur-sm"
    >
      <form onSubmit={submit} className="p-5 panel-in">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="join-title" className="t-h2">{edit ? "Your profile" : "Join the community"}</h2>
            {!edit && <p className="t-small text-text-2 mt-1">Rate places, ask questions, share tips and see who else is going. No email or password needed.</p>}
          </div>
          <button type="button" className="btn btn-ghost btn-icon -mr-2 -mt-1" aria-label="Close" onClick={() => onClose(false)}>
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="mt-5 flex items-center gap-4">
          <span className="pop" key={avatar + hue}>
            <Avatar p={{ avatar, hue, name }} size={64} />
          </span>
          <div className="flex-1 min-w-0">
            <label htmlFor="join-name" className="label">Name others will see</label>
            <div className="flex gap-1.5">
              <input id="join-name" className="field flex-1 min-w-0" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} autoComplete="nickname" required />
              <button type="button" className="btn btn-secondary btn-icon" aria-label="Suggest another name" title="Suggest another name" onClick={() => setName(suggestName())}>
                <Shuffle size={16} aria-hidden />
              </button>
            </div>
          </div>
        </div>

        <fieldset className="mt-4">
          <legend className="label">Pick an avatar</legend>
          <div className="grid grid-cols-10 gap-1">
            {AVATARS.map((a) => (
              <button key={a} type="button" aria-pressed={avatar === a} aria-label={`Avatar ${a}`} onClick={() => setAvatar(a)} className={`press grid aspect-square place-items-center rounded-[var(--radius-s)] text-lg ${avatar === a ? "bg-cyan/10 ring-2 ring-cyan" : "hover:bg-panel-2"}`}>
                {a}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-3">
          <legend className="label">Colour</legend>
          <div className="flex gap-1.5">
            {HUES.map((h) => (
              <button key={h} type="button" aria-pressed={hue === h} aria-label={`Colour ${h}`} onClick={() => setHue(h)} className={`press h-7 w-7 rounded-full ${hue === h ? "ring-2 ring-offset-2 ring-text" : ""}`} style={{ background: `hsl(${h} 85% 72%)` }} />
            ))}
          </div>
        </fieldset>

        <div className="mt-3">
          <label htmlFor="join-bio" className="label">About you <span className="text-text-3 font-normal">(optional)</span></label>
          <input id="join-bio" className="field w-full" value={bio} maxLength={160} placeholder="Fado lover, Benfica fan, always front row…" onChange={(e) => setBio(e.target.value)} />
        </div>

        {error && <p role="alert" className="t-small text-bad mt-3">{error}</p>}

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="t-micro text-text-3 max-w-[14rem]">Your profile is kept on this browser. Be kind: posts reported by several people are hidden.</p>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : edit ? "Save" : "Join"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
