"use client";

import { useState } from "react";
import { Plus, Sparkles, Trash2, ListChecks } from "lucide-react";
import { userActions, type Trip } from "@/lib/user/store";
import { LISTS, listIdeas, listProgress, newId, type CheckItem, type ListKind } from "@/lib/trip-share";
import { toast } from "../toast";
import { Glyph } from "../glyph";

/*
 * The trip's lists: what to do before leaving, what to pack, which documents to bring. Each
 * with ideas drawn from the trip itself (a flight means a check-in, a car a licence), one tap
 * to add, a big box to tick, and who takes care of it when travelling together.
 */
export function TripLists({ trip, canEdit }: { trip: Trip; canEdit: boolean }) {
  const [list, setList] = useState<ListKind>("todo");
  const [text, setText] = useState("");
  const items = trip.checklist ?? [];
  const travellers = trip.travellers ?? [];
  const content = { stops: trip.stops ?? [], plans: trip.plans ?? [], events: trip.eventIds.map((id) => ({ id })), checklist: items, start: trip.start, end: trip.end };
  const ideas = canEdit ? listIdeas(content, list).slice(0, 8) : [];
  // On a shared trip: only what's yours to do, at a tap.
  const meT = travellers.find((t) => t.member && t.member === trip.group?.me)?.id;
  const [onlyMine, setOnlyMine] = useState(false);
  const mine = items.filter((x) => x.list === list && (!onlyMine || x.who === meT));
  // Still to do first, then what's done.
  const ordered = [...mine.filter((x) => !x.done), ...mine.filter((x) => x.done)];
  const all = listProgress(items);
  const add = (t: string) => {
    const clean = t.trim();
    if (!clean) return;
    // Added while looking at "Mine": it's yours.
    userActions.putTripItem(trip.id, "checklist", { id: newId(), list, text: clean.slice(0, 160), ...(onlyMine && meT ? { who: meT } : {}), createdAt: new Date().toISOString() });
  };
  const put = (x: CheckItem) => userActions.putTripItem(trip.id, "checklist", x);
  const remove = (x: CheckItem) => {
    userActions.removeTripItem(trip.id, "checklist", x.id);
    toast({ title: "Taken off the list", body: x.text, emoji: "🗑️", action: { label: "Undo", run: () => put(x) } });
  };
  const nameOf = (id?: string) => travellers.find((t) => t.id === id)?.name;

  return (
    <div className="lists">
      {all.all > 0 && (
        <p className="t-micro text-text-2 mb-2 tnum" aria-live="polite">
          {all.done === all.all ? "Everything's ready." : `${all.done} of ${all.all} done`}
        </p>
      )}
      <div className="list-tabs" role="tablist" aria-label="Lists">
        {LISTS.map((l) => {
          const p = listProgress(items, l.id);
          return (
            <button key={l.id} type="button" role="tab" aria-selected={list === l.id} className="list-tab" onClick={() => setList(l.id)}>
              <Glyph e={l.emoji} size={16} fallback={ListChecks} />
              <span className="min-w-0">
                <span className="block font-semibold leading-tight">{l.label}</span>
                <span className="block t-micro text-text-2 tnum">{p.all ? `${p.done}/${p.all}` : l.blurb}</span>
              </span>
              {p.all > 0 && <span className="list-ring" style={{ "--p": p.done / p.all } as React.CSSProperties} aria-hidden />}
            </button>
          );
        })}
      </div>

      {meT && travellers.length > 1 && (
        <div className="flex gap-1.5 mt-3" role="group" aria-label="Show">
          <button type="button" className="chip" aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)}>Everyone&apos;s</button>
          <button type="button" className="chip" aria-pressed={onlyMine} onClick={() => setOnlyMine(true)}>
            Mine <span className="tnum">{items.filter((x) => x.list === list && x.who === meT && !x.done).length || ""}</span>
          </button>
        </div>
      )}
      {canEdit && (
        <form className="list-add mt-3" onSubmit={(e) => (e.preventDefault(), add(text), setText(""))}>
          <label htmlFor="list-new" className="sr-only">Add to {LISTS.find((l) => l.id === list)?.label}</label>
          <input id="list-new" className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder={list === "packing" ? "Swimsuit, camera…" : list === "documents" ? "Passport, insurance policy…" : "Book the museum, buy an adapter…"} maxLength={160} />
          <button type="submit" className="btn btn-primary btn-icon press" aria-label="Add" disabled={!text.trim()}><Plus size={18} aria-hidden /></button>
        </form>
      )}

      {ordered.length > 0 && (
        <ul className="check-list mt-3">
          {ordered.map((x) => (
            <li key={x.id} className="check-row" data-done={x.done ? "" : undefined}>
              <label className="check-hit">
                <input type="checkbox" checked={!!x.done} disabled={!canEdit} onChange={(e) => put({ ...x, done: e.target.checked || undefined })} />
                <span className="check-box" aria-hidden />
                <span className="check-text">{x.text}</span>
              </label>
              {list === "documents" && canEdit && (
                <label className="check-due" title="When it expires">
                  <span className="sr-only">{x.text}: expires on</span>
                  <input type="date" className="field !h-8 !w-auto text-[12px] touch:!text-base" value={x.due ?? ""} onChange={(e) => put({ ...x, due: e.target.value || undefined })} />
                </label>
              )}
              {list === "documents" && !canEdit && x.due && <span className="t-micro text-text-2">expires {x.due}</span>}
              {travellers.length > 1 && (canEdit ? (
                <select className="check-who" value={x.who ?? ""} onChange={(e) => put({ ...x, who: e.target.value || undefined })} aria-label={`Who takes care of ${x.text}`}>
                  <option value="">Anyone</option>
                  {travellers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              ) : x.who ? <span className="t-micro text-text-2">{nameOf(x.who)}</span> : null)}
              {canEdit && (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${x.text}`} onClick={() => remove(x)}><Trash2 size={14} aria-hidden /></button>
              )}
            </li>
          ))}
        </ul>
      )}

      {ideas.length > 0 && (
        <section className="mt-4" aria-labelledby="ideas-h">
          <h3 id="ideas-h" className="t-micro font-semibold text-text-2 flex items-center gap-1"><Sparkles size={13} aria-hidden /> Ideas for this trip: tap to add</h3>
          <ul className="flex flex-wrap gap-1.5 mt-2">
            {ideas.map((t) => (
              <li key={t}>
                <button type="button" className="chip chip-idea press" onClick={() => add(t)}><Plus size={13} aria-hidden /> {t}</button>
              </li>
            ))}
          </ul>
          {ideas.length > 2 && (
            <button type="button" className="t-micro font-semibold text-cyan hover:underline mt-2" onClick={() => ideas.forEach(add)}>Add all {ideas.length}</button>
          )}
        </section>
      )}
    </div>
  );
}
