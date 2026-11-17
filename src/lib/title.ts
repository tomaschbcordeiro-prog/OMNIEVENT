/**
 * Titles typed in capitals ("BILHETE MUSEU + EXPOSIÇÃO TEMPORÁRIA") shown in ordinary case
 * ("Bilhete Museu + Exposição Temporária"): easier to read, and no event shouts over the
 * others in a list. Mixed-case titles are left exactly as they are.
 */
import { isShouting } from "./quality";

// Small words kept in lower case inside a title, in the languages the listings come in.
const SMALL = new Set(
  (
    "a o e é as os de da do das dos em no na nos nas ao à com por para um uma " +
    "y el la los las del en con por para un una " +
    "le les des du au aux et en dans sur pour avec un une " +
    "il lo gli di del della e per con " +
    "der die das den dem und im am zum zur von mit für " +
    "of the and in on at to for with by from or an vs"
  ).split(" "),
);
// Kept in capitals: initials and short names that are always written so.
const KEEP = new Set("DJ DJS MC FC SC CF AC NBA NFL NHL MLB UFC WWE F1 MOTOGP UEFA FIFA ATP WTA CCB MUDE MAAT MNAA MNAC CCCB MOMA BBC RTP SIC TVI UK USA EUA ONU MEO EDP BPI CGD RTL ZDF ARD VIP LGBT LGBTQ LGBTQIA+ II III IV VI VII VIII IX XI XII XIII XIV XV XX XXI".split(" "));

function word(w: string, first: boolean): string {
  // Words with digits ("2026", "4K") and initials kept as they are.
  if (/\d/.test(w)) return w;
  const bare = w.replace(/[^\p{L}+]/gu, "");
  if (KEEP.has(bare.toUpperCase())) return w;
  const lower = w.toLocaleLowerCase();
  if (!first && SMALL.has(bare.toLocaleLowerCase())) return lower;
  // Capital after an opening quote, bracket or apostrophe start ("(ao Vivo)", "«Fado»").
  return lower.replace(/\p{L}/u, (c) => c.toLocaleUpperCase());
}

export function tidyTitle(title: string): string {
  if (!isShouting(title)) return title;
  let first = true;
  return title
    .split(/(\s+|-(?=\p{L})|\/)/u)
    .map((part) => {
      if (!part.trim() || part === "-" || part === "/") return part;
      const out = word(part, first);
      // After a colon, dash or full stop a new phrase starts.
      first = /[:.!?–—|]$/.test(part);
      return out;
    })
    .join("")
    .replace(/(\s[–—-]\s|:\s|\|\s)(\p{Ll})/gu, (_, sep: string, c: string) => sep + c.toLocaleUpperCase());
}
