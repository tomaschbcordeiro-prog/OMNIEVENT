/**
 * Ticket sellers people use in each country (primary sellers and the main resale sites), with their public search pages.
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

type Seller = { id: string; name: string; search: (q: string, city: string) => string };
const q = (s: string) => encodeURIComponent(s);
const tm = (domain: string): Seller => ({ id: "ticketmaster", name: "Ticketmaster", search: (s) => `https://www.${domain}/search?q=${q(s)}` });
const eventbrite = (domain: string, country: string): Seller => ({ id: "eventbrite", name: "Eventbrite", search: (s) => `https://www.${domain}/d/${country}/${q(s)}/` });
// CTS Eventim's national sites share one search address.
const eventim = (id: string, name: string, domain: string): Seller => ({ id, name, search: (s) => `https://www.${domain}/search/?searchterm=${q(s)}` });
const stubhub: Seller = { id: "stubhub", name: "StubHub", search: (s) => `https://www.stubhub.com/search?q=${q(s)}` };
const seatgeek: Seller = { id: "seatgeek", name: "SeatGeek", search: (s) => `https://seatgeek.com/search?search=${q(s)}` };
const vivid: Seller = { id: "vividseats", name: "Vivid Seats", search: (s) => `https://www.vividseats.com/search?searchTerm=${q(s)}` };
const axs: Seller = { id: "axs", name: "AXS", search: (s) => `https://www.axs.com/search?q=${q(s)}` };

const SELLERS: Record<string, Seller[]> = {
  PT: [
    { id: "bol", name: "BOL", search: (s) => `https://www.bol.pt/Comprar/Pesquisa?q=${q(s)}` },
    { id: "ticketline", name: "Ticketline", search: (s) => `https://www.ticketline.pt/pesquisa?query=${q(s)}` },
    { id: "blueticket", name: "MEO Blueticket", search: (s) => `https://blueticket.meo.pt/pt/search?q=${q(s)}` },
    { id: "eventbrite", name: "Eventbrite", search: (s, city) => `https://www.eventbrite.pt/d/portugal--${slug(PT_CITY[city] ?? (city || "Lisboa"))}/${q(s)}/` },
  ],
  US: [tm("ticketmaster.com"), seatgeek, stubhub, vivid, axs, eventbrite("eventbrite.com", "united-states")],
  CA: [tm("ticketmaster.ca"), seatgeek, stubhub, vivid, eventbrite("eventbrite.ca", "canada")],
  MX: [tm("ticketmaster.com.mx"), stubhub],
  GB: [tm("ticketmaster.co.uk"), { id: "seetickets", name: "See Tickets", search: (s) => `https://www.seetickets.com/search?q=${q(s)}` }, axs, stubhub, eventbrite("eventbrite.co.uk", "united-kingdom")],
  IE: [tm("ticketmaster.ie"), stubhub, eventbrite("eventbrite.ie", "ireland")],
  ES: [tm("ticketmaster.es"), stubhub, eventbrite("eventbrite.es", "spain")],
  FR: [
    { id: "ticketmaster", name: "Ticketmaster", search: (s) => `https://www.ticketmaster.fr/fr/resultat?ipSearch=${q(s)}` },
    eventim("fnac", "Fnac Spectacles", "fnacspectacles.com"),
    stubhub,
    eventbrite("eventbrite.fr", "france"),
  ],
  DE: [tm("ticketmaster.de"), eventim("eventim", "Eventim", "eventim.de"), stubhub, eventbrite("eventbrite.de", "germany")],
  AT: [tm("ticketmaster.at"), eventim("oeticket", "oeticket", "oeticket.com"), stubhub],
  CH: [tm("ticketmaster.ch"), eventim("ticketcorner", "Ticketcorner", "ticketcorner.ch"), stubhub],
  IT: [tm("ticketmaster.it"), eventim("ticketone", "TicketOne", "ticketone.it"), stubhub, eventbrite("eventbrite.it", "italy")],
  NL: [tm("ticketmaster.nl"), stubhub, eventbrite("eventbrite.nl", "netherlands")],
  BE: [tm("ticketmaster.be"), stubhub, eventbrite("eventbrite.be", "belgium")],
  DK: [tm("ticketmaster.dk"), stubhub],
  SE: [tm("ticketmaster.se"), stubhub],
  NO: [tm("ticketmaster.no"), stubhub],
  FI: [tm("ticketmaster.fi"), stubhub],
  PL: [tm("ticketmaster.pl"), stubhub],
  CZ: [tm("ticketmaster.cz"), stubhub],
  AU: [tm("ticketmaster.com.au"), stubhub, eventbrite("eventbrite.com.au", "australia")],
  NZ: [tm("ticketmaster.co.nz"), stubhub, eventbrite("eventbrite.co.nz", "new-zealand")],
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
  const terms = searchTerms(title);
  return (SELLERS[countryCode] ?? [])
    .filter((s) => !skip.has(s.name.toLowerCase()))
    .map((s) => ({ id: s.id, name: s.name, url: s.search(terms, city) }));
}
