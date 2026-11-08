import type { ProviderBatch } from "./providers/types";

/**
 * One copy of each repeated text in a source's data. Parsed from JSON, every record holds its
 * own copy of texts that are the same across many records: a tour's description and title on
 * each of its dates, a venue's id, the moment the source was read, a link repeated as the
 * official page, the source page and the ticket link. A server holds a couple of hundred
 * thousand records, close to its memory limit; sharing those copies frees tens of megabytes.
 * Only text values change hands (each is replaced by an equal one), so nothing reads differently.
 */
/** Fields that are different on every record: looking them up would only cost time. */
const UNIQUE = new Set(["id", "canonicalId", "slug", "externalId"]);

export function internBatch<T extends ProviderBatch>(batch: T): T {
  const pool = new Map<string, string>();
  const one = (s: string): string => {
    const kept = pool.get(s);
    if (kept !== undefined) return kept;
    pool.set(s, s);
    return s;
  };
  const strings = (o: Record<string, unknown> | undefined) => {
    if (!o) return;
    for (const k in o) {
      const v = o[k];
      if (typeof v === "string") {
        if (v.length > 6 && !UNIQUE.has(k)) o[k] = one(v);
      } else if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          const x = v[i];
          if (typeof x === "string") {
            if (x.length > 6) v[i] = one(x);
          } else if (x && typeof x === "object" && !Array.isArray(x)) strings(x as Record<string, unknown>);
        }
      } else if (v && typeof v === "object") strings(v as Record<string, unknown>);
    }
  };
  for (const list of [batch.events, batch.venues, batch.participants, batch.offers] as unknown as Record<string, unknown>[][]) for (const r of list ?? []) strings(r);
  return batch;
}
