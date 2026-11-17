"use client";

import { useState } from "react";
import { Mail, Phone, Plus, Trash2, UserPlus } from "lucide-react";
import { userActions, type Trip } from "@/lib/user/store";
import { newId, type Contact } from "@/lib/trip-share";
import { kindLabel } from "@/lib/trip-plans";
import { toast } from "../toast";
import { PersonDot } from "./together";

/*
 * The rest of what a trip needs: who's travelling, the numbers that matter (hotel, guide,
 * insurance, someone at home), the booking references in one list, and notes for anything else.
 */
export function TripInfo({ trip, canEdit }: { trip: Trip; canEdit: boolean }) {
  const travellers = trip.travellers ?? [];
  const contacts = trip.contacts ?? [];
  const refs = (trip.plans ?? []).filter((p) => p.ref);
  const [who, setWho] = useState("");
  const [adding, setAdding] = useState(false);

  return (
    <div className="info">
      <section aria-labelledby="who-h">
        <h3 id="who-h" className="t-small font-semibold">Who&apos;s travelling</h3>
        <p className="t-micro text-text-2 mt-0.5">To split costs and share out the lists. People who join the trip appear here by themselves.</p>
        <ul className="mt-2 grid gap-1">
          {travellers.map((t) => (
            <li key={t.id} className="person-row">
              <PersonDot id={t.member ?? t.id} name={t.name} size={28} />
              <span className="flex-1 min-w-0 font-semibold truncate">{t.name}</span>
              {t.member ? <span className="t-micro text-text-3">on the trip</span> : canEdit && (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${t.name}`} onClick={() => {
                  if ((trip.expenses ?? []).some((e) => e.paidBy === t.id || e.split?.includes(t.id)) && !window.confirm(`${t.name} is in some costs. Remove anyway? Those costs will no longer count for them.`)) return;
                  userActions.removeTripItem(trip.id, "travellers", t.id);
                }}><Trash2 size={14} aria-hidden /></button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <form className="list-add mt-2" onSubmit={(e) => {
            e.preventDefault();
            const n = who.trim();
            if (!n) return;
            userActions.putTripItem(trip.id, "travellers", { id: newId(), name: n.slice(0, 40) });
            setWho("");
          }}>
            <label htmlFor="who-new" className="sr-only">Add a traveller</label>
            <input id="who-new" className="field" value={who} onChange={(e) => setWho(e.target.value)} placeholder={travellers.length ? "Someone else coming? Their name" : "Your name, and who's coming"} maxLength={40} />
            <button type="submit" className="btn btn-secondary btn-icon press" aria-label="Add traveller" disabled={!who.trim()}><UserPlus size={17} aria-hidden /></button>
          </form>
        )}
      </section>

      <section className="mt-6" aria-labelledby="contacts-h">
        <div className="flex items-center justify-between gap-2">
          <h3 id="contacts-h" className="t-small font-semibold">Contacts</h3>
          {canEdit && !adding && <button type="button" className="btn btn-secondary btn-sm press" onClick={() => setAdding(true)}><Plus size={14} aria-hidden /> Add</button>}
        </div>
        {adding && <ContactForm onSave={(c) => (userActions.putTripItem(trip.id, "contacts", c), setAdding(false))} onCancel={() => setAdding(false)} />}
        {contacts.length === 0 && !adding ? (
          <p className="t-micro text-text-2 mt-1">The hotel, a guide, the insurance helpline, someone at home: their numbers, ready when you need them.</p>
        ) : (
          <ul className="mt-2 grid gap-1.5">
            {contacts.map((c) => (
              <li key={c.id} className="contact-row">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold truncate">{c.name}{c.role && <span className="t-micro font-normal text-text-2"> · {c.role}</span>}</span>
                  {c.note && <span className="block t-micro text-text-2">{c.note}</span>}
                </span>
                {c.phone && <a className="btn btn-secondary btn-icon btn-sm" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${c.name}, ${c.phone}`}><Phone size={14} aria-hidden /></a>}
                {c.email && <a className="btn btn-secondary btn-icon btn-sm" href={`mailto:${c.email}`} aria-label={`Email ${c.name}`}><Mail size={14} aria-hidden /></a>}
                {canEdit && <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${c.name}`} onClick={() => {
                  userActions.removeTripItem(trip.id, "contacts", c.id);
                  toast({ title: "Contact removed", body: c.name, emoji: "🗑️", action: { label: "Undo", run: () => userActions.putTripItem(trip.id, "contacts", c) } });
                }}><Trash2 size={14} aria-hidden /></button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {refs.length > 0 && (
        <section className="mt-6" aria-labelledby="refs-h">
          <h3 id="refs-h" className="t-small font-semibold">Booking references</h3>
          <ul className="mt-2 grid gap-1">
            {refs.map((p) => (
              <li key={p.id} className="ref-row">
                <span className="min-w-0 flex-1 truncate t-small">{p.title} <span className="t-micro text-text-3">· {kindLabel(p.kind)}</span></span>
                <button type="button" className="ref-code tnum" title="Copy" onClick={() => void navigator.clipboard?.writeText(p.ref!).then(() => toast({ title: "Copied", body: p.ref, emoji: "📋" })).catch(() => {})}>{p.ref}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6" aria-labelledby="notes-h">
        <h3 id="notes-h" className="t-small font-semibold">Notes</h3>
        {canEdit ? (
          <textarea
            className="field min-h-[7rem] mt-2"
            defaultValue={trip.notes ?? ""}
            key={trip.notes ?? ""}
            onBlur={(e) => e.target.value !== (trip.notes ?? "") && userActions.updateTrip(trip.id, { notes: e.target.value.slice(0, 8000) || undefined })}
            placeholder="Addresses, the Wi-Fi, door codes, what to remember…"
            aria-labelledby="notes-h"
          />
        ) : (
          <p className="t-small text-text-2 mt-2 whitespace-pre-wrap">{trip.notes || "No notes yet."}</p>
        )}
        {trip.group && <p className="t-micro text-text-3 mt-1">Only the people in this trip can see it.</p>}
      </section>
    </div>
  );
}

function ContactForm({ onSave, onCancel }: { onSave: (c: Contact) => void; onCancel: () => void }) {
  const [c, setC] = useState({ name: "", role: "", phone: "", email: "", note: "" });
  const set = (k: keyof typeof c) => (e: React.ChangeEvent<HTMLInputElement>) => setC((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="expense-form mt-2 panel-in" onSubmit={(e) => {
      e.preventDefault();
      if (!c.name.trim()) return;
      onSave({ id: newId(), name: c.name.trim(), role: c.role.trim() || undefined, phone: c.phone.trim() || undefined, email: c.email.trim() || undefined, note: c.note.trim() || undefined });
    }}>
      <div className="grid grid-cols-2 gap-2">
        <label><span className="label">Name</span><input className="field" value={c.name} onChange={set("name")} required maxLength={80} autoFocus /></label>
        <label><span className="label">Who they are</span><input className="field" value={c.role} onChange={set("role")} placeholder="Hotel, guide…" maxLength={40} list="contact-roles" /></label>
        <label><span className="label">Phone</span><input className="field" type="tel" value={c.phone} onChange={set("phone")} maxLength={40} autoComplete="off" /></label>
        <label><span className="label">Email</span><input className="field" type="email" value={c.email} onChange={set("email")} maxLength={120} autoComplete="off" /></label>
      </div>
      <datalist id="contact-roles">
        {["Hotel", "Guide", "Driver", "Insurance", "Embassy", "Airline", "Host", "Family at home"].map((r) => <option key={r} value={r} />)}
      </datalist>
      <label className="block mt-2"><span className="label">Note</span><input className="field" value={c.note} onChange={set("note")} maxLength={300} placeholder="Policy number, opening hours…" /></label>
      <div className="mt-3 flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm press" disabled={!c.name.trim()}>Save</button>
        <button type="button" className="btn btn-ghost btn-sm press" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
