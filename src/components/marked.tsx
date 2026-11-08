import type { ReactNode } from "react";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** The title with the searched words marked (accents and case ignored). */
export function Marked({ text, terms }: { text: string; terms?: string[] }) {
  const words = (terms ?? []).map(fold).filter((t) => t.length >= 2);
  if (!words.length) return <>{text}</>;
  // Folding keeps one character per character for Latin text, so positions line up; when it
  // doesn't (some scripts), the title is shown as it is.
  const folded = fold(text);
  if (folded.length !== text.length) return <>{text}</>;
  const hits: [number, number][] = [];
  for (const w of words) {
    let i = folded.indexOf(w);
    while (i >= 0) {
      hits.push([i, i + w.length]);
      i = folded.indexOf(w, i + w.length);
    }
  }
  if (!hits.length) return <>{text}</>;
  hits.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let at = 0;
  for (const [s, e] of hits) {
    if (s < at) continue;
    if (s > at) out.push(text.slice(at, s));
    out.push(<mark key={s} className="hit">{text.slice(s, e)}</mark>);
    at = e;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}
