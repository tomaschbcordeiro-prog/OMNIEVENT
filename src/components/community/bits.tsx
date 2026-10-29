"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Check, ChevronDown, Eye, EyeOff, LogOut, Star, X } from "lucide-react";
import { AVATARS, BADGES, USERNAME_RE, type Profile, type PublicProfile } from "@/lib/community/types";
import { communityPost, deleteAccount, getMe, hasAccount, refreshMe, setMe, signIn, signOut, signUp, useMe } from "@/lib/community/client";
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
    <Link href={`/community/u/${p.username ?? p.id}`} className={`font-semibold hover:text-cyan ${className}`} title={p.username ? `@${p.username}` : undefined}>
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

// ---- Account --------------------------------------------------------------------------------

export type AccountMode = "signup" | "signin" | "complete" | "edit";
type AccountRequest = { resolve: (ok: boolean) => void; mode: AccountMode };
let pending: AccountRequest | null = null;
const joinListeners = new Set<() => void>();
const emitJoin = () => joinListeners.forEach((l) => l());

/** Opens the account dialog in the given mode; resolves true if the visitor ends up signed in. */
export function openAccount(mode: AccountMode): Promise<boolean> {
  return new Promise((resolve) => {
    pending?.resolve(false);
    pending = { resolve, mode };
    emitJoin();
  });
}

/**
 * Resolves true straight away for a signed-in member; otherwise asks them to create an account
 * (or finish one started before accounts existed). `edit` opens their profile settings.
 */
export function requireMember(_hasProfile?: boolean, edit = false): Promise<boolean> {
  if (edit) return openAccount("edit");
  if (hasAccount()) return Promise.resolve(true);
  return openAccount(getMe().profile ? "complete" : "signup");
}

/** Mounted once in the layout: renders the account dialog on request. */
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
  return <AccountDialog key={req.mode} initial={req.mode} onClose={close} />;
}

const HUES = [210, 265, 330, 5, 28, 45, 95, 160, 190];
const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

function PasswordField({ id, label, value, onChange, autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="relative">
        <input id={id} type={show ? "text" : "password"} className="field w-full pr-11" value={value} minLength={8} maxLength={128} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} required />
        <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 btn btn-ghost btn-icon btn-sm" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((v) => !v)}>
          {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
    </div>
  );
}

function AccountDialog({ initial, onClose }: { initial: AccountMode; onClose: (ok: boolean) => void }) {
  const { profile, account } = useMe();
  const [mode, setMode] = useState<AccountMode>(initial);
  const [firstName, setFirstName] = useState(account?.firstName ?? "");
  const [lastName, setLastName] = useState(account?.lastName ?? "");
  const [username, setUsername] = useState(account?.username ?? "");
  const [usernameTouched, setUsernameTouched] = useState(!!account?.username);
  const [email, setEmail] = useState(account?.email ?? "");
  const [password, setPassword] = useState("");
  const [login, setLogin] = useState("");
  const [avatar, setAvatar] = useState(profile?.avatar ?? AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  const [hue, setHue] = useState(profile?.hue ?? HUES[Math.floor(Math.random() * HUES.length)]);
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [nextPw, setNextPw] = useState("");
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  // Until they type one, the username follows the name: "Maria Costa" → "mariacosta".
  useEffect(() => {
    if (!usernameTouched && (mode === "signup" || mode === "complete")) setUsername(slug(`${firstName}${lastName}`).slice(0, 20));
  }, [firstName, lastName, usernameTouched, mode]);

  const usernameOk = USERNAME_RE.test(username);
  // Errors are shown next to the field they're about; anything else under the form.
  const [emailTouched, setEmailTouched] = useState(false);
  const emailBad = emailTouched && email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const errField = mode === "signin" || !error ? null : /username/i.test(error) ? "user" : /e-?mail/i.test(error) ? "email" : /password/i.test(error) && mode !== "edit" ? "pw" : /\bname\b/i.test(error) ? "name" : null;
  const fieldError = (f: string, id: string) => errField === f && <p id={id} role="alert" className="t-small text-bad mt-1">{error}</p>;
  const shownName = `${firstName} ${lastName}`.trim() || "Your name";
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (mode === "signin") {
        const p = await signIn(login, password);
        toast({ emoji: p.avatar, title: `Welcome back, ${p.firstName ?? p.name}!` });
      } else if (mode === "edit") {
        const r = await communityPost<{ profile: PublicProfile }>({ action: "profile", firstName, lastName, username, email, avatar, hue, bio });
        if (pwOpen && nextPw) await communityPost({ action: "password", current: currentPw, next: nextPw });
        setMe(r.profile);
        await refreshMe();
        toast({ title: "Profile saved", emoji: r.profile.avatar });
      } else {
        const p = await signUp({ firstName, lastName, username, email, password, avatar, hue, bio: bio || undefined });
        toast({ celebrate: true, emoji: p.avatar, title: `Welcome, ${p.firstName ?? p.name}!`, body: "Your account is ready. You earned the 🌱 Newcomer badge." });
      }
      onClose(true);
    });
  };

  const title = { signup: "Create your account", signin: "Welcome back", complete: "Finish your account", edit: "Your profile" }[mode];
  const intro = {
    signup: "Rate places, ask questions, share tips and see who else is going. Use it on any device.",
    signin: "Sign in with your email or username.",
    complete: "Add your name, a username and an email to keep your posts and points, on any device.",
    edit: "",
  }[mode];

  return (
    <dialog
      ref={ref}
      aria-labelledby="join-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose(false);
      }}
      onClick={(e) => e.target === ref.current && onClose(false)}
      className="dialog-backdrop m-auto w-[min(480px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[var(--radius-l)] bg-panel p-0 text-text shadow-2xl backdrop:bg-[rgb(13_27_51_/_0.45)] backdrop:backdrop-blur-sm"
    >
      <form onSubmit={submit} className="panel-in">
        {mode !== "signin" && (
          <div className="account-hero relative px-5 pt-5 pb-4" style={{ ["--h" as string]: hue }}>
            <div className="flex items-start justify-between gap-3">
              <h2 id="join-title" className="t-h2">{title}</h2>
              <button type="button" className="btn btn-ghost btn-icon -mr-2 -mt-1" aria-label="Close" onClick={() => onClose(false)}>
                <X size={18} aria-hidden />
              </button>
            </div>
            {intro && <p className="t-small text-text-2 mt-1">{intro}</p>}
            <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-m)] bg-panel/80 p-3 shadow-sm" aria-hidden>
              <span className="pop" key={avatar + hue}>
                <Avatar p={{ avatar, hue, name: shownName }} size={52} />
              </span>
              <div className="min-w-0">
                <p className="font-semibold truncate">{shownName}</p>
                <p className="t-small text-text-2 truncate">@{username || "username"}</p>
              </div>
            </div>
          </div>
        )}

        <div className="px-5 pb-5 pt-4">
          {mode === "signin" ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="join-title" className="t-h2">{title}</h2>
                  <p className="t-small text-text-2 mt-1">{intro}</p>
                </div>
                <button type="button" className="btn btn-ghost btn-icon -mr-2 -mt-1" aria-label="Close" onClick={() => onClose(false)}>
                  <X size={18} aria-hidden />
                </button>
              </div>
              <div className="mt-4 grid gap-3">
                <div>
                  <label htmlFor="acc-login" className="label">Email or username</label>
                  <input id="acc-login" className="field w-full" value={login} autoComplete="username" onChange={(e) => setLogin(e.target.value)} required autoFocus />
                </div>
                <PasswordField id="acc-pw" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
              </div>
            </>
          ) : (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="acc-first" className="label">First name</label>
                  <input id="acc-first" className="field w-full" value={firstName} maxLength={30} autoComplete="given-name" onChange={(e) => setFirstName(e.target.value)} required autoFocus={mode !== "edit"} aria-invalid={errField === "name" || undefined} aria-describedby={errField === "name" ? "acc-name-err" : undefined} />
                </div>
                <div>
                  <label htmlFor="acc-last" className="label">Last name</label>
                  <input id="acc-last" className="field w-full" value={lastName} maxLength={30} autoComplete="family-name" onChange={(e) => setLastName(e.target.value)} required aria-invalid={errField === "name" || undefined} />
                </div>
              </div>
              {fieldError("name", "acc-name-err")}
              <div>
                <label htmlFor="acc-user" className="label">Username</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" aria-hidden>@</span>
                  <input
                    id="acc-user"
                    className="field w-full pl-7 pr-9"
                    value={username}
                    maxLength={20}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-describedby={errField === "user" ? "acc-user-err acc-user-hint" : "acc-user-hint"}
                    aria-invalid={errField === "user" || (usernameTouched && !!username && !usernameOk) || undefined}
                    onChange={(e) => {
                      setUsernameTouched(true);
                      setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ""));
                    }}
                    required
                  />
                  {username && <span className={`absolute right-3 top-1/2 -translate-y-1/2 ${usernameOk ? "text-ok" : "text-text-3"}`} aria-hidden>{usernameOk ? <Check size={16} /> : null}</span>}
                </div>
                {fieldError("user", "acc-user-err")}
                <p id="acc-user-hint" className={`t-small mt-1 ${usernameTouched && username && !usernameOk ? "text-bad" : "text-text-3"}`}>3 to 20 letters, numbers, dots or underscores{usernameTouched && username && !usernameOk ? ", starting and ending with a letter or number" : ""}. Your profile link: /community/u/{username || "username"}</p>
              </div>
              <div>
                <label htmlFor="acc-email" className="label">Email</label>
                <input id="acc-email" type="email" className="field w-full" value={email} maxLength={254} autoComplete="email" onChange={(e) => setEmail(e.target.value)} onBlur={() => setEmailTouched(true)} required aria-invalid={errField === "email" || emailBad || undefined} aria-describedby="acc-email-hint" />
                {fieldError("email", "acc-email-err")}
                <p id="acc-email-hint" className={`t-small mt-1 ${emailBad ? "text-bad" : "text-text-3"}`}>{emailBad ? "That doesn't look like an email address. Check for a typo, like a missing @ or dot." : "Only you see it; it's how you sign in."}</p>
              </div>
              {mode !== "edit" && (
                <div>
                  <PasswordField id="acc-pw" label="Password" value={password} onChange={setPassword} autoComplete="new-password" />
                  {fieldError("pw", "acc-pw-err")}
                </div>
              )}

              <details className="group rounded-[var(--radius-m)] border border-line" open={mode === "edit"}>
                <summary className="cursor-pointer list-none px-3 py-2.5 flex items-center justify-between t-small font-medium">
                  <span>Make it yours <span className="text-text-3 font-normal">(avatar, colour, bio)</span></span>
                  <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="px-3 pb-3">
                  <fieldset>
                    <legend className="sr-only">Avatar</legend>
                    <div className="grid grid-cols-10 gap-1">
                      {AVATARS.map((a) => (
                        <button key={a} type="button" aria-pressed={avatar === a} aria-label={`Avatar ${a}`} onClick={() => setAvatar(a)} className={`press grid aspect-square place-items-center rounded-[var(--radius-s)] text-lg ${avatar === a ? "bg-cyan/10 ring-2 ring-cyan" : "hover:bg-panel-2"}`}>
                          {a}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="mt-3">
                    <legend className="sr-only">Colour</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {HUES.map((h) => (
                        <button key={h} type="button" aria-pressed={hue === h} aria-label={`Colour ${h}`} onClick={() => setHue(h)} className={`press h-7 w-7 rounded-full ${hue === h ? "ring-2 ring-offset-2 ring-text" : ""}`} style={{ background: `hsl(${h} 85% 72%)` }} />
                      ))}
                    </div>
                  </fieldset>
                  <label htmlFor="acc-bio" className="label mt-3">About you</label>
                  <input id="acc-bio" className="field w-full" value={bio} maxLength={160} placeholder="Fado lover, Benfica fan, always front row…" onChange={(e) => setBio(e.target.value)} />
                </div>
              </details>

              {mode === "edit" && (
                <details className="group rounded-[var(--radius-m)] border border-line" onToggle={(e) => setPwOpen((e.target as HTMLDetailsElement).open)}>
                  <summary className="cursor-pointer list-none px-3 py-2.5 flex items-center justify-between t-small font-medium">
                    Change password
                    <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  {pwOpen && (
                    <div className="px-3 pb-3 grid gap-2">
                      <PasswordField id="acc-cur" label="Current password" value={currentPw} onChange={setCurrentPw} autoComplete="current-password" />
                      <PasswordField id="acc-new" label="New password" value={nextPw} onChange={setNextPw} autoComplete="new-password" />
                    </div>
                  )}
                </details>
              )}
              {mode === "edit" && (
                <details className="group rounded-[var(--radius-m)] border border-line" onToggle={(e) => setDelOpen((e.target as HTMLDetailsElement).open)}>
                  <summary className="cursor-pointer list-none px-3 py-2.5 flex items-center justify-between t-small font-medium text-bad">
                    Delete account
                    <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  {delOpen && (
                    <div className="px-3 pb-3 grid gap-2">
                      <p className="t-small text-text-2">This removes your name, username, email, points and plans. Your posts stay in their conversations as from a former member. It can&apos;t be undone.</p>
                      <PasswordField id="acc-del" label="Your password, to confirm" value={delPw} onChange={setDelPw} autoComplete="current-password" />
                      <button
                        type="button"
                        className="btn btn-sm bg-bad text-white hover:opacity-90"
                        disabled={busy || delPw.length < 8}
                        onClick={() =>
                          void run(async () => {
                            await deleteAccount(delPw);
                            toast({ title: "Your account was deleted", emoji: "👋" });
                            onClose(false);
                          })
                        }
                      >
                        Delete my account
                      </button>
                    </div>
                  )}
                </details>
              )}
            </div>
          )}

          {error && !errField && <p role="alert" className="t-small text-bad mt-3">{error}</p>}

          <button type="submit" className="btn btn-primary w-full mt-5 press" disabled={busy}>
            {busy ? "One moment…" : { signup: "Create account", signin: "Sign in", complete: "Save my account", edit: "Save changes" }[mode]}
          </button>

          <div className="mt-3 text-center t-small text-text-2">
            {mode === "signup" && (
              <>Already have an account? <button type="button" className="font-semibold text-cyan hover:underline" onClick={() => { setError(""); setMode("signin"); }}>Sign in</button></>
            )}
            {mode === "signin" && (
              <>New here? <button type="button" className="font-semibold text-cyan hover:underline" onClick={() => { setError(""); setMode(getMe().profile ? "complete" : "signup"); }}>Create an account</button></>
            )}
            {mode === "complete" && (
              <>Have an account already? <button type="button" className="font-semibold text-cyan hover:underline" onClick={() => { setError(""); setMode("signin"); }}>Sign in</button></>
            )}
            {mode === "edit" && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 font-semibold text-bad hover:underline"
                onClick={() =>
                  void run(async () => {
                    await signOut();
                    toast({ title: "Signed out", emoji: "👋" });
                    onClose(false);
                  })
                }
              >
                <LogOut size={15} aria-hidden /> Sign out
              </button>
            )}
          </div>
          {mode !== "signin" && mode !== "edit" && <p className="t-micro text-text-3 mt-3 text-center">Be kind: posts reported by several people are hidden. Your email and password are never shown to anyone.</p>}
        </div>
      </form>
    </dialog>
  );
}
