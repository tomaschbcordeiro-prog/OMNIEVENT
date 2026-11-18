"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, KeyRound, Loader2, Users } from "lucide-react";
import { joinTrip, peekTrip, rememberName, rememberedName, type Peek } from "@/lib/group-sync";
import { useUser } from "@/lib/user/store";

const fmt = (d?: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");

/**
 * Coming into someone's trip: with their link (it's in the address) or by typing their PIN.
 * First what the trip is and who's planning it, then your name, then you're in.
 */
export function JoinTrip({ invite, initialCode = "" }: { invite?: string; initialCode?: string }) {
  const router = useRouter();
  const user = useUser();
  const [code, setCode] = useState(initialCode);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(rememberedName()), []);
  const by = () => (invite ? { invite } : { code });
  const look = async () => {
    setBusy(true);
    setError(null);
    try {
      setPeek(await peekTrip(by()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  // With a link, the trip shows straight away; with a PIN in the address too.
  useEffect(() => {
    if (invite || initialCode) void look();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mine = peek ? user.trips.find((t) => t.group?.id === peek.id) : undefined;
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      rememberName(name);
      const id = await joinTrip(by(), name.trim());
      router.push(`/trips/${id}?joined=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
      setBusy(false);
    }
  };
  // Typed any way: lower case, spaces, with or without the dash.
  const typed = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

  return (
    <main id="main" className="mx-auto max-w-md px-4 pt-10 pb-24">
      <p className="t-small font-semibold text-text-3">Trips</p>
      <h1 className="t-h1 mt-1">Join a trip</h1>

      {!peek && !invite && (
        <form className="mt-6 surface rounded-[var(--radius-l)] p-5" onSubmit={(e) => (e.preventDefault(), void look())}>
          <label htmlFor="pin" className="label flex items-center gap-1.5"><KeyRound size={14} aria-hidden /> The trip&apos;s PIN</label>
          <input
            id="pin"
            className="field pin-field tnum"
            value={typed.length > 4 ? `${typed.slice(0, 4)}-${typed.slice(4)}` : typed}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            aria-describedby="pin-help"
          />
          <p id="pin-help" className="t-micro text-text-2 mt-1.5">8 letters and numbers, like K7QM-2XPA. Whoever invited you finds it in their trip: they tap Invite (or People).</p>
          {error && <p className="mt-3 t-small text-bad" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary press mt-4 w-full" disabled={busy || typed.length !== 8}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ArrowRight size={16} aria-hidden />} Find the trip
          </button>
        </form>
      )}

      {invite && !peek && (
        <div className="mt-6 surface rounded-[var(--radius-l)] p-5" aria-busy={busy}>
          {busy ? <p className="t-body text-text-2 flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden /> Opening the invitation…</p> : null}
          {error && (
            <>
              <p className="mt-1 t-body text-bad" role="alert">{error}</p>
              <Link href="/trips/join" className="btn btn-secondary btn-sm mt-4">Use a PIN instead</Link>
            </>
          )}
        </div>
      )}

      {peek && (
        <div className="mt-6 surface rounded-[var(--radius-l)] p-5 panel-in">
          <p className="t-h2"><span aria-hidden>{peek.emoji}</span> {peek.name}</p>
          <p className="t-small text-text-2 mt-1">
            {peek.start && peek.end ? `${fmt(peek.start)} – ${fmt(peek.end)}` : "Dates to be decided"}
            {peek.cities.length > 0 && ` · ${peek.cities.join(" → ")}`}
          </p>
          <p className="t-small mt-3 flex items-center gap-1.5"><Users size={15} aria-hidden className="text-text-2" /> {peek.by ? `${peek.by}${peek.people > 1 ? ` and ${peek.people - 1} more` : ""} ${peek.people > 1 ? "are" : "is"} planning it` : `${peek.people} planning it`}</p>
          {mine ? (
            <Link href={`/trips/${mine.id}`} className="btn btn-primary press mt-5 w-full">You&apos;re already in it: open the trip</Link>
          ) : (
            <form onSubmit={(e) => void join(e)} className="mt-5">
              <label className="block">
                <span className="label">Your name, as the others will see it</span>
                <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder="e.g. Ana" autoComplete="given-name" />
              </label>
              {error && <p className="mt-3 t-small text-bad" role="alert">{error}</p>}
              <button type="submit" className="btn btn-primary press mt-4 w-full" disabled={busy || !name.trim()}>
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Users size={16} aria-hidden />} Join the trip
              </button>
              <p className="t-micro text-text-3 mt-3">No account needed. The trip is kept on this device too, so it opens even without internet.</p>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
