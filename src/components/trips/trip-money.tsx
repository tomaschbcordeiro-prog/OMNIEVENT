"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, CornerDownLeft, Pencil, Plus, Send, SlidersHorizontal, Trash2, Wallet, X, Coins } from "lucide-react";
import { userActions, type Trip } from "@/lib/user/store";
import { categoryForKind, EXPENSE_CATEGORIES, guessCategory, moneySummary, moneyText, newId, parseExpense, perTraveller, settleUp, type Expense, type ExpenseCategory } from "@/lib/trip-share";
import { convert, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { kindLabel } from "@/lib/trip-plans";
import { toast } from "../toast";
import { PersonDot } from "./together";
import { Glyph } from "../glyph";

/*
 * The trip's money, all in one place: a budget and how much of it is spoken for, what each
 * thing costs (bookings included), what kind of spending it is, and, travelling with others,
 * who paid what and the fewest payments that leave everyone even.
 */

const money = (n: number, cur: string) => {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, maximumFractionDigits: n % 1 === 0 || Math.abs(n) >= 1000 ? 0 : 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
};
const COMMON = ["EUR", "USD", "GBP", "BRL", "CHF", "JPY", "CAD", "AUD"];
const CURRENCIES = [...COMMON, ...SUPPORTED_CURRENCIES.filter((c) => !COMMON.includes(c)).sort()];

export function TripMoney({ trip, canEdit }: { trip: Trip; canEdit: boolean }) {
  const cur = trip.currency ?? "EUR";
  const expenses = useMemo(() => trip.expenses ?? [], [trip.expenses]);
  const travellers = trip.travellers ?? [];
  const content = { expenses, currency: cur, travellers };
  const sum = moneySummary(content);
  const per = perTraveller(content);
  const pay = settleUp(per);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [adding, setAdding] = useState(false);
  const nameOf = (id?: string) => travellers.find((t) => t.id === id)?.name ?? "Someone";
  const budget = trip.budget;
  const used = budget ? Math.min(1, sum.total / budget) : 0;
  // Bookings without a price yet: one tap from having one.
  // A cost with the booking's own name counts as its price too.
  const priced = new Set(expenses.map((e) => e.planId).filter(Boolean));
  const pricedNames = new Set(expenses.map((e) => e.title.trim().toLowerCase()));
  const unpriced = (trip.plans ?? []).filter((p) => ["flight", "train", "bus", "car", "stay", "activity", "visit", "meal"].includes(p.kind) && !priced.has(p.id) && !pricedNames.has(p.title.trim().toLowerCase()) && p.day).slice(0, 8);
  const remove = (e: Expense) => {
    userActions.removeTripItem(trip.id, "expenses", e.id);
    toast({ title: "Cost removed", body: e.title, emoji: "🗑️", action: { label: "Undo", run: () => userActions.putTripItem(trip.id, "expenses", e) } });
  };
  const byDay = [...expenses].sort((a, b) => (b.day ?? b.createdAt).localeCompare(a.day ?? a.createdAt));

  return (
    <div className="money">
      <section className="money-top" aria-label="Budget">
        <div className="flex items-baseline justify-between gap-3">
          <p className="money-total tnum">
            {money(sum.total, cur)}
            {sum.converted && <span className="t-micro text-text-3 font-normal ml-1" title="Converted at approximate rates">≈</span>}
          </p>
          {budget ? <p className="t-small text-text-2 tnum">of {money(budget, cur)}</p> : null}
        </div>
        {budget ? (
          <>
            <div className="money-bar" role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={Math.round(sum.total)} aria-label="Budget used" data-over={sum.total > budget ? "" : undefined}>
              <i style={{ width: `${(Math.min(sum.booked, budget) / budget) * 100}%` }} />
              <i className="money-bar-est" style={{ width: `${Math.max(0, used - Math.min(sum.booked, budget) / budget) * 100}%` }} />
            </div>
            <p className="t-micro text-text-2 mt-1.5 tnum">
              {sum.total > budget ? <span className="text-bad font-semibold">{money(sum.total - budget, cur)} over budget</span> : <><b className="text-text">{money(budget - sum.total, cur)}</b> left</>}
              {sum.estimated > 0 && <> · {money(sum.estimated, cur)} still estimates</>}
            </p>
          </>
        ) : (
          <p className="t-micro text-text-2 mt-1">{sum.estimated > 0 ? `${money(sum.booked, cur)} paid or booked, ${money(sum.estimated, cur)} estimated.` : "Set a budget to see how much is left."}</p>
        )}
        {canEdit && (
          <div className="money-settings">
            <label>
              <span className="t-micro text-text-2">Budget</span>
              <input className="field !h-9 tnum" inputMode="decimal" placeholder="e.g. 2000" defaultValue={budget ?? ""} key={`b-${budget ?? ""}`} onBlur={(e) => {
                const n = Number(e.target.value.replace(",", "."));
                userActions.updateTrip(trip.id, { budget: e.target.value.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined });
              }} aria-label="Budget for the whole trip" />
            </label>
            <label>
              <span className="t-micro text-text-2">Currency</span>
              <select className="field !h-9" value={cur} onChange={(e) => userActions.updateTrip(trip.id, { currency: e.target.value })} aria-label="The trip's currency">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
        )}
        {sum.unconverted.length > 0 && <p className="t-micro text-warn mt-2">{sum.unconverted.length} {sum.unconverted.length === 1 ? "cost is" : "costs are"} in a currency the site can&apos;t convert, so not counted above.</p>}
        {sum.converted && <p className="t-micro text-text-3 mt-1">Other currencies are converted at approximate rates, not today&apos;s exact rate.</p>}
      </section>

      {canEdit && !adding && !editing && <QuickCost trip={trip} onMore={(draft) => (setEditing(draft), setAdding(false))} />}

      {sum.total > 0 && (
        <section className="mt-4" aria-labelledby="cats-h">
          <h3 id="cats-h" className="t-small font-semibold">Where it goes</h3>
          <ul className="money-cats mt-2">
            {EXPENSE_CATEGORIES.filter((c) => sum.byCategory[c.id] > 0).sort((a, b) => sum.byCategory[b.id] - sum.byCategory[a.id]).map((c) => (
              <li key={c.id}>
                <Glyph e={c.emoji} />
                <span className="flex-1 min-w-0 truncate">{c.label}</span>
                <span className="money-cat-bar" aria-hidden><i style={{ width: `${(sum.byCategory[c.id] / sum.total) * 100}%` }} /></span>
                <span className="tnum font-semibold">{money(sum.byCategory[c.id], cur)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {travellers.length >= 2 && expenses.some((e) => !e.estimate) && (
        <section className="mt-5" aria-labelledby="split-h">
          <div className="flex items-center justify-between gap-2">
            <h3 id="split-h" className="t-small font-semibold">Who paid, who owes</h3>
            <button type="button" className="btn btn-ghost btn-sm press" onClick={() => {
              const text = moneyText({ name: trip.name, expenses, travellers, currency: cur, budget }, money);
              const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
              if (nav.share) void nav.share({ title: trip.name, text }).catch(() => {});
              else void navigator.clipboard?.writeText(text).then(() => toast({ title: "Copied", body: "Paste it in your group chat.", emoji: "📋" })).catch(() => {});
            }}>
              <Send size={14} aria-hidden /> Send to the group
            </button>
          </div>
          <ul className="mt-2 grid gap-1">
            {travellers.map((t) => {
              const x = per[t.id] ?? { paid: 0, share: 0 };
              const bal = x.paid - x.share;
              return (
                <li key={t.id} className="person-row">
                  <PersonDot id={t.member ?? t.id} name={t.name} size={28} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold truncate">{t.name}</span>
                    <span className="block t-micro text-text-2 tnum">paid {money(x.paid, cur)} · share {money(x.share, cur)}</span>
                  </span>
                  <span className={`tnum t-small font-semibold ${Math.abs(bal) < 0.01 ? "text-text-3" : bal > 0 ? "text-ok" : "text-bad"}`}>
                    {Math.abs(bal) < 0.01 ? "even" : bal > 0 ? `gets ${money(bal, cur)}` : `owes ${money(-bal, cur)}`}
                  </span>
                </li>
              );
            })}
          </ul>
          {pay.length > 0 ? (
            <ul className="settle mt-3" aria-label="To settle up">
              {pay.map((p) => (
                <li key={`${p.from}-${p.to}`}>
                  <span className="min-w-0 flex-1"><b>{nameOf(p.from)}</b> <ArrowRight size={13} aria-hidden className="inline -mt-0.5" /> <b>{nameOf(p.to)}</b> <span className="tnum">{money(p.amount, cur)}</span></span>
                  {canEdit && (
                    <button type="button" className="btn btn-secondary btn-sm press" onClick={() => {
                      userActions.putTripItem(trip.id, "expenses", { id: newId(), title: `${nameOf(p.from)} paid ${nameOf(p.to)} back`, amount: Math.round(p.amount * 100) / 100, currency: cur, category: "other", paidBy: p.from, split: [p.to], createdAt: new Date().toISOString() });
                      toast({ title: "Settled", body: `${nameOf(p.from)} paid ${nameOf(p.to)} ${money(p.amount, cur)}`, emoji: "🤝" });
                    }}>
                      <Check size={14} aria-hidden /> Paid
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="t-micro text-ok mt-2">Everyone is even.</p>
          )}
        </section>
      )}

      {canEdit && unpriced.length > 0 && (
        <section className="mt-5" aria-labelledby="unpriced-h">
          <h3 id="unpriced-h" className="t-small font-semibold">Bookings without a price</h3>
          <ul className="mt-2 grid gap-1.5">
            {unpriced.map((p) => (
              <li key={p.id} className="unpriced-row">
                <span className="min-w-0 flex-1">
                  <span className="block t-small font-semibold truncate">{p.title}</span>
                  <span className="block t-micro text-text-2">{kindLabel(p.kind)}</span>
                </span>
                <form className="flex items-center gap-1" onSubmit={(e) => {
                  e.preventDefault();
                  const input = (e.currentTarget.elements.namedItem("amount") as HTMLInputElement);
                  const n = Number(input.value.replace(",", "."));
                  if (!Number.isFinite(n) || n <= 0) return;
                  userActions.putTripItem(trip.id, "expenses", { id: newId(), title: p.title, amount: Math.round(n * 100) / 100, currency: cur, category: categoryForKind(p.kind), day: p.day, planId: p.id, paidBy: travellers.length === 1 ? travellers[0].id : undefined, createdAt: new Date().toISOString() });
                }}>
                  <input name="amount" className="field !h-9 !w-24 tnum" inputMode="decimal" placeholder={cur} aria-label={`Price of ${p.title}, in ${cur}`} />
                  <button type="submit" className="btn btn-secondary btn-icon btn-sm" aria-label={`Add the price of ${p.title}`}><Plus size={15} aria-hidden /></button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-5" aria-labelledby="costs-h">
        <div className="flex items-center justify-between gap-2">
          <h3 id="costs-h" className="t-small font-semibold">Costs <span className="text-text-3 font-normal tnum">{expenses.length || ""}</span></h3>
          {canEdit && !adding && !editing && (
            <button type="button" className="btn btn-ghost btn-sm press" onClick={() => (setEditing(null), setAdding(true))}>
              <SlidersHorizontal size={14} aria-hidden /> Add with details
            </button>
          )}
        </div>
        {(adding || editing) && canEdit && (
          <ExpenseForm
            key={editing?.id ?? "new"}
            trip={trip}
            start={editing}
            isNew={!!editing && !expenses.some((e) => e.id === editing.id)}
            onDone={() => (setAdding(false), setEditing(null))}
          />
        )}
        {!expenses.length && !adding ? (
          <div className="money-empty mt-3">
            <Wallet size={22} aria-hidden className="text-text-3" />
            <p className="t-small text-text-2">Put every cost here as you book or pay: flights, the hotel, dinners, tickets. The budget, the categories and who owes whom add up by themselves.</p>
          </div>
        ) : (
          <ul className="expense-list mt-2">
            {byDay.map((e) => {
              const cat = EXPENSE_CATEGORIES.find((c) => c.id === e.category);
              const v = e.currency !== cur ? convert(e.amount, e.currency, cur) : undefined;
              return (
                <li key={e.id} className="expense-row">
                  <span className="expense-cat" aria-hidden><Glyph e={cat?.emoji} size={16} fallback={Coins} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block t-small font-semibold truncate">{e.title}{e.estimate && <span className="expense-est">estimate</span>}</span>
                    <span className="block t-micro text-text-2 truncate">
                      {e.day ? new Date(`${e.day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : cat?.label}
                      {e.paidBy && ` · ${nameOf(e.paidBy)} paid`}
                      {e.split?.length && travellers.length > 1 ? ` · for ${e.split.map(nameOf).join(", ")}` : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block t-small font-semibold tnum">{money(e.amount, e.currency)}</span>
                    {v !== undefined && <span className="block t-micro text-text-3 tnum">≈ {money(v, cur)}</span>}
                  </span>
                  {canEdit && (
                    <span className="flex">
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Change ${e.title}`} onClick={() => (setAdding(false), setEditing(e))}><Pencil size={14} aria-hidden /></button>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${e.title}`} onClick={() => remove(e)}><Trash2 size={14} aria-hidden /></button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One cost: what, how much, what kind, who paid and who it's for. The kind guesses itself from the name. */
function ExpenseForm({ trip, start, onDone, isNew }: { trip: Trip; start: Expense | null; onDone: () => void; isNew?: boolean }) {
  const travellers = trip.travellers ?? [];
  const cur = trip.currency ?? "EUR";
  const meTraveller = travellers.find((t) => t.member && t.member === trip.group?.me)?.id ?? (travellers.length === 1 ? travellers[0].id : undefined);
  const [title, setTitle] = useState(start?.title ?? "");
  const [amount, setAmount] = useState(start ? String(start.amount) : "");
  const [currency, setCurrency] = useState(start?.currency ?? cur);
  const [category, setCategory] = useState<ExpenseCategory>(start?.category ?? "other");
  const [touchedCat, setTouchedCat] = useState(!!start);
  const [paidBy, setPaidBy] = useState(start?.paidBy ?? meTraveller ?? "");
  const [split, setSplit] = useState<string[]>(start?.split ?? []);
  const [estimate, setEstimate] = useState(!!start?.estimate);
  const [day, setDay] = useState(start?.day ?? "");
  const n = Number(amount.replace(",", "."));
  const ok = title.trim() && Number.isFinite(n) && n > 0;
  const everyone = split.length === 0;
  const toggle = (id: string) => setSplit((s) => {
    const base = s.length ? s : travellers.map((t) => t.id);
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    return next.length === travellers.length ? [] : next;
  });
  return (
    <form
      className="expense-form mt-3 panel-in"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        userActions.putTripItem(trip.id, "expenses", {
          ...(start ?? {}),
          id: start?.id ?? newId(),
          title: title.trim(),
          amount: Math.round(n * 100) / 100,
          currency,
          category,
          day: day || undefined,
          paidBy: paidBy || undefined,
          split: split.length ? split : undefined,
          estimate: estimate || undefined,
          planId: start?.planId ?? (trip.plans ?? []).find((p) => p.title.trim().toLowerCase() === title.trim().toLowerCase())?.id,
          createdAt: start?.createdAt ?? new Date().toISOString(),
        });
        onDone();
      }}
    >
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className="min-w-0">
          <span className="label">What</span>
          <input className="field" value={title} autoFocus onChange={(e) => {
            setTitle(e.target.value);
            if (!touchedCat) setCategory(guessCategory(e.target.value));
          }} placeholder="Dinner at Ramiro, hotel, museum…" maxLength={120} required />
        </label>
        <label>
          <span className="label">Amount</span>
          <span className="flex gap-1">
            <input className="field !w-24 tnum" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" required aria-label="Amount" />
            <select className="field !w-[5.5rem]" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </span>
        </label>
      </div>
      <fieldset className="mt-3">
        <legend className="label">Kind</legend>
        <div className="flex flex-wrap gap-1.5">
          {EXPENSE_CATEGORIES.map((c) => (
            <button key={c.id} type="button" className="chip" aria-pressed={category === c.id} onClick={() => (setCategory(c.id), setTouchedCat(true))}>
              <Glyph e={c.emoji} /> {c.label}
            </button>
          ))}
        </div>
      </fieldset>
      {travellers.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <label>
            <span className="label">Paid by</span>
            <select className="field" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              <option value="">Not paid yet / not sure</option>
              {travellers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {travellers.length > 1 && (
            <fieldset>
              <legend className="label">For</legend>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="chip" aria-pressed={everyone} onClick={() => setSplit([])}>Everyone</button>
                {travellers.map((t) => (
                  <button key={t.id} type="button" className="chip" aria-pressed={!everyone && split.includes(t.id)} onClick={() => toggle(t.id)}>{t.name}</button>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3 mt-3">
        <label>
          <span className="label">Day <span className="text-text-3 font-normal">(optional)</span></span>
          <input type="date" className="field !w-auto" value={day} min={trip.start} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 t-small pb-2.5">
          <input type="checkbox" checked={estimate} onChange={(e) => setEstimate(e.target.checked)} /> Just an estimate (not booked yet)
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="submit" className="btn btn-primary press" disabled={!ok}><Check size={15} aria-hidden /> {start && !isNew ? "Save" : "Add"}</button>
        <button type="button" className="btn btn-ghost press" onClick={onDone}><X size={15} aria-hidden /> Cancel</button>
      </div>
    </form>
  );
}

/**
 * A cost in one line, the way it's said: "dinner 45€ paid by Ana", "taxi 12,50", "museu 30
 * para a Eva e a Ana". What it understood shows as it's typed; Enter adds it; "More" opens
 * every field with it filled in.
 */
function QuickCost({ trip, onMore }: { trip: Trip; onMore: (draft: Expense) => void }) {
  const [text, setText] = useState("");
  const travellers = trip.travellers ?? [];
  const cur = trip.currency ?? "EUR";
  const me = travellers.find((t) => t.member && t.member === trip.group?.me)?.id ?? (travellers.length === 1 ? travellers[0].id : undefined);
  const p = parseExpense(text, travellers, cur);
  const ready = !!p.title && p.amount !== undefined && p.amount > 0;
  const nameOf = (id: string) => travellers.find((t) => t.id === id)?.name ?? "";
  const draft = (): Expense => ({ id: newId(), title: p.title || text.trim(), amount: p.amount ?? 0, currency: p.currency, category: p.category, paidBy: p.paidBy ?? me, split: p.split, createdAt: new Date().toISOString() });
  const cat = EXPENSE_CATEGORIES.find((c) => c.id === p.category);
  return (
    <form
      className="quick-cost mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        const x = draft();
        userActions.putTripItem(trip.id, "expenses", x);
        toast({ title: "Cost added", body: `${x.title}, ${money(x.amount, x.currency)}`, emoji: cat?.emoji ?? "💶", action: { label: "Undo", run: () => userActions.removeTripItem(trip.id, "expenses", x.id) } });
        setText("");
      }}
    >
      <label htmlFor="quick-cost" className="sr-only">Add a cost in one line</label>
      <div className="quick-cost-line">
        <input
          id="quick-cost"
          className="field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={travellers.length > 1 ? `Dinner 45€ paid by ${travellers[1]?.name ?? "Ana"}` : "Dinner 45€, taxi 12, hotel 300…"}
          autoComplete="off"
          enterKeyHint="done"
          aria-describedby="quick-cost-read"
        />
        <button type="submit" className="btn btn-primary btn-icon press" aria-label="Add this cost" disabled={!ready}><CornerDownLeft size={16} aria-hidden /></button>
      </div>
      <p id="quick-cost-read" className="quick-cost-read" aria-live="polite">
        {text.trim() ? (
          <>
            <span className="qc-chip"><Glyph e={cat?.emoji} size={13} /> {cat?.label}</span>
            {p.amount !== undefined ? <span className="qc-chip qc-amount tnum">{money(p.amount, p.currency)}</span> : <span className="qc-chip qc-missing">add an amount</span>}
            {(p.paidBy ?? me) && travellers.length > 1 && <span className="qc-chip">paid by {nameOf((p.paidBy ?? me)!)}</span>}
            {p.split && <span className="qc-chip">for {p.split.map(nameOf).join(", ")}</span>}
            <button type="button" className="qc-more" onClick={() => onMore(draft())}>More…</button>
          </>
        ) : (
          <span className="t-micro text-text-3">Type it as you&apos;d say it: what, how much{travellers.length > 1 ? ", who paid, and who it's for" : ""}. Enter adds it.</span>
        )}
      </p>
    </form>
  );
}
