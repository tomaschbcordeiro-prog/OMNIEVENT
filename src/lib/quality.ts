/**
 * How likely a listing is to interest someone browsing what's on: open data feeds also carry
 * information sessions, school visits, job fairs, MBA open days, council meetings and titles
 * typed in capitals. They stay findable (a search for them finds them), but in a day's list
 * they come after the concerts, plays, games and shows.
 */
import type { EventCard } from "./types";

// Said in a title: administrative, commercial or school business rather than an outing.
const DULL_TITLE = new RegExp(
  [
    "webinar", "webinaire", "r[ée]union d'information", "s[ée]ance d'information", "information session", "info session", "sess[ãa]o de esclarecimento",
    "reuni[ãa]o", "assembl[ée]e g[ée]n[ée]rale", "general assembly", "permanence", "inscriptions?", "inscri[çc][õo]es", "candidaturas",
    "open days?", "journ[ée]es? portes? ouvertes?", "portes? ouvertes?", "dia aberto", "executive (mba|open|education)", "\\bmba\\b",
    "formation", "training course", "job ?dating", "forum (de l')?emploi", "career fair", "recrutement", "recruitment", "p[ôo]le emploi",
    "conf[ée]rence de presse", "press conference", "allocations?", "atelier cv", "cv workshop", "consultation", "examens?", "concours d'entr[ée]e",
    "conseil municipal", "city council", "c[âa]mara municipal", "intervention", "visite (de |d')?(l'|la |le )?(entreprise|usine|coll[èe]ge|lyc[ée]e|[ée]cole)",
    "semaine de l'industrie", "industry week", "journ[ée]e (de l')?entreprise", "visite d'entreprise", "salon (de l')?emploi", "salon professionnel",
    "coll[èe]ge [\\p{L}]", "lyc[ée]e [\\p{L}]", "[ée]cole (primaire|maternelle|[ée]l[ée]mentaire)",
  ].join("|"),
  "iu",
);
// Where it is: a school or an office rather than a place people go out to.
const DULL_PLACE = /\b(coll[èe]ge|lyc[ée]e|[ée]cole (primaire|maternelle|[ée]l[ée]mentaire)|agrupamento de escolas|escola (b[áa]sica|secund[áa]ria)|elementary school|high school|middle school|mairie annexe|p[ôo]le emploi|agence)\b/i;
// What it is: the kinds where those mostly turn up.
const SOFT_KINDS = new Set(["education", "conferences", "culture", "career-fairs", "business-conferences", "public-lectures", "masterclasses", "trade-fairs", "other"]);

/** Shouting: most of a longish title's letters in capitals. */
export function isShouting(title: string): boolean {
  const letters = title.replace(/[^\p{L}]/gu, "");
  if (letters.length < 12) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  return upper / letters.length > 0.8;
}

/** 0 for an ordinary listing, more the less likely it is to interest someone looking for an outing. */
export function dullness(c: Pick<EventCard, "title" | "venueName" | "categorySlug" | "groupSlug" | "imageUrl">): number {
  let d = 0;
  if (DULL_TITLE.test(c.title)) d += 2;
  if (DULL_PLACE.test(c.venueName ?? "")) d += 1;
  if (isShouting(c.title)) d += 1;
  if (d && (SOFT_KINDS.has(c.groupSlug) || SOFT_KINDS.has(c.categorySlug))) d += 0.5;
  if (d && !c.imageUrl) d += 0.5;
  return d;
}

/** A listing to show after the rest of its day. */
export const isDull = (c: Pick<EventCard, "title" | "venueName" | "categorySlug" | "groupSlug" | "imageUrl">) => dullness(c) >= 2;
