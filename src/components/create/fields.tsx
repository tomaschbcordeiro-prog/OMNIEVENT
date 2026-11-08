"use client";

import { useId, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/** A question: its label, an optional hint, the control, and the problem with it if any. */
export function Field({ label, hint, error, optional, children, htmlFor, counter }: { label: string; hint?: ReactNode; error?: string; optional?: boolean; children: ReactNode; htmlFor?: string; counter?: { n: number; max: number } }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="font-semibold text-[15px]">
          {label}
          {optional && <span className="ml-1.5 t-micro font-normal text-text-3">optional</span>}
        </label>
        {counter && <span className={`t-micro tnum ${counter.n > counter.max ? "text-bad" : "text-text-3"}`}>{counter.n}/{counter.max}</span>}
      </div>
      {hint && <p className="t-small text-text-2 -mt-0.5">{hint}</p>}
      {children}
      {error && (
        <p role="alert" className="t-small text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

/** Words added as chips: type and press Enter or comma; suggestions add with a tap. */
export function TagInput({ id, values, onChange, placeholder, max, suggestions = [], maxLength = 40 }: { id?: string; values: string[]; onChange: (v: string[]) => void; placeholder: string; max: number; suggestions?: string[]; maxLength?: number }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const v = raw.trim().replace(/\s+/g, " ").slice(0, maxLength);
    if (!v || values.length >= max || values.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    onChange([...values, v]);
  };
  const left = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 8);
  return (
    <div>
      <div className="field flex min-h-11 flex-wrap items-center gap-1.5 !py-1.5 focus-within:ring-2 focus-within:ring-cyan/40">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-text/[0.07] pl-2.5 pr-1 py-0.5 t-small">
            {v}
            <button type="button" className="grid h-5 w-5 place-items-center rounded-full hover:bg-text/10" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        {values.length < max && (
          <input
            id={id}
            className="min-w-[8rem] flex-1 bg-transparent outline-none t-body"
            placeholder={values.length ? "Add another…" : placeholder}
            value={text}
            maxLength={maxLength + 5}
            onChange={(e) => {
              const v = e.target.value;
              if (v.includes(",")) {
                v.split(",").slice(0, -1).forEach(add);
                setText(v.split(",").at(-1) ?? "");
              } else setText(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(text);
                setText("");
              } else if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
            }}
            onBlur={() => {
              if (text.trim()) {
                add(text);
                setText("");
              }
            }}
          />
        )}
      </div>
      {left.length > 0 && values.length < max && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {left.map((s) => (
            <button key={s} type="button" className="chip press !h-7 text-[12.5px]" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One choice out of a few, as a row of pills. */
export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={`chip press ${value === o.value ? "!bg-text !text-on-ink !border-text" : ""}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** An on/off switch with its label and hint. */
export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex items-center justify-between gap-4 rounded-[var(--radius-m)] border border-line bg-panel px-3.5 py-3 ${disabled ? "opacity-50" : "cursor-pointer hover:border-line-strong"}`}>
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block t-small text-text-2">{hint}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-line-strong transition-colors peer-checked:bg-cyan peer-focus-visible:ring-2 peer-focus-visible:ring-cyan/50" aria-hidden />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" aria-hidden />
      </span>
    </label>
  );
}
