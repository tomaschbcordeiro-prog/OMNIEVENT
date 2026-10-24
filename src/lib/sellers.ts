/**
 * Ticket sellers people use in each country, with their public search pages.
 *
 * None of these sellers offers an open data feed, so we cannot read their prices or
 * availability. For comparison we open each seller's own search for the event, and say
 * clearly that we haven't checked whether they sell it.
 */
export interface SellerSearch {
  id: string;
  name: string;
  url: string;
}

const SELLERS: Record<string, { id: string; name: string; search: (q: string, city: string) => string }[]> = {
  PT: [
    { id: "bol", name: "BOL", search: (q) => `https://www.bol.pt/Comprar/Pesquisa?q=${encodeURIComponent(q)}` },
    { id: "ticketline", name: "Ticketline", search: (q) => `https://www.ticketline.pt/pesquisa?query=${encodeURIComponent(q)}` },
    { id: "blueticket", name: "MEO Blueticket", search: (q) => `https://blueticket.meo.pt/pt/search?q=${encodeURIComponent(q)}` },
    { id: "eventbrite", name: "Eventbrite", search: (q, city) => `https://www.eventbrite.pt/d/portugal--${slug(PT_CITY[city] ?? (city || "Lisboa"))}/${encodeURIComponent(q)}/` },
  ],
};

// Eventbrite's Portuguese city pages use local names.
const PT_CITY: Record<string, string> = { Lisbon: "Lisboa", Oporto: "Porto" };

const slug = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Shorten a listing title to the words a seller's search box will match on. */
export function searchTerms(title: string): string {
  const clean = title
    .replace(/[«»"“”'’()[\]|:;,.!?–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.split(" ").slice(0, 6).join(" ");
}

/** Search links for sellers in the event's country, minus the ones already listed as offers. */
export function sellerSearches(countryCode: string, title: string, city: string, exclude: string[] = []): SellerSearch[] {
  const skip = new Set(exclude.map((p) => p.toLowerCase()));
  const q = searchTerms(title);
  return (SELLERS[countryCode] ?? [])
    .filter((s) => !skip.has(s.name.toLowerCase()))
    .map((s) => ({ id: s.id, name: s.name, url: s.search(q, city) }));
}
