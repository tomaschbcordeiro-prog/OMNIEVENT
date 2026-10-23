/**
 * i18n foundation. UI chrome and category labels are translated here; event
 * content stays in the provider's language. Add a locale by adding a dictionary.
 * RTL locales should set `dir` on <html> (see LOCALE_DIR).
 */
export const LOCALES = ["en", "pt", "es", "fr", "de"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", pt: "Português", es: "Español", fr: "Français", de: "Deutsch" };
export const LOCALE_DIR: Partial<Record<string, "rtl">> = { ar: "rtl", he: "rtl", fa: "rtl", ur: "rtl" };
export const INTL_LOCALE: Record<Locale, string> = { en: "en-GB", pt: "pt-PT", es: "es-ES", fr: "fr-FR", de: "de-DE" };

type Dict = Record<string, string>;

const en: Dict = {
  "nav.discover": "Discover",
  "nav.events": "Events",
  "nav.categories": "Categories",
  "nav.destinations": "Destinations",
  "nav.myworld": "My World",
  "search.placeholder": "Search events, artists, teams, venues or places",
  "cat.music": "Music",
  "cat.sports": "Sports",
  "cat.theatre": "Theatre",
  "cat.comedy": "Comedy",
  "cat.festivals": "Festivals",
  "cat.cinema": "Cinema",
  "cat.conferences": "Conferences",
  "cat.technology": "Technology",
  "cat.exhibitions": "Exhibitions",
  "cat.attractions": "Attractions",
  "cat.food-drink": "Food & drink",
  "cat.nightlife": "Nightlife",
  "cat.family": "Family",
  "cat.outdoor": "Outdoor",
  "cat.education": "Workshops",
  "cat.fashion": "Fashion",
  "cat.culture": "Culture",
  "cat.other": "Other",
};

const pt: Dict = {
  "nav.discover": "Descobrir",
  "nav.events": "Eventos",
  "nav.categories": "Categorias",
  "nav.destinations": "Destinos",
  "nav.myworld": "O Meu Mundo",
  "search.placeholder": "Pesquisar eventos, artistas, equipas, recintos ou locais",
  "cat.music": "Música",
  "cat.sports": "Desporto",
  "cat.theatre": "Teatro",
  "cat.comedy": "Comédia",
  "cat.festivals": "Festivais",
  "cat.cinema": "Cinema",
  "cat.conferences": "Conferências",
  "cat.technology": "Tecnologia",
  "cat.exhibitions": "Exposições",
  "cat.attractions": "Atrações",
  "cat.food-drink": "Comida e bebida",
  "cat.nightlife": "Vida noturna",
  "cat.family": "Família",
  "cat.outdoor": "Ar livre",
  "cat.education": "Workshops",
  "cat.fashion": "Moda",
  "cat.culture": "Cultura",
  "cat.other": "Outros",
};

const es: Dict = {
  "nav.discover": "Descubrir",
  "nav.events": "Eventos",
  "nav.categories": "Categorías",
  "nav.destinations": "Destinos",
  "nav.myworld": "Mi Mundo",
  "search.placeholder": "Busca eventos, artistas, equipos, recintos o lugares",
  "cat.music": "Música",
  "cat.sports": "Deportes",
  "cat.theatre": "Teatro",
  "cat.comedy": "Comedia",
  "cat.festivals": "Festivales",
  "cat.cinema": "Cine",
  "cat.conferences": "Conferencias",
  "cat.technology": "Tecnología",
  "cat.exhibitions": "Exposiciones",
  "cat.attractions": "Atracciones",
  "cat.food-drink": "Comida y bebida",
  "cat.nightlife": "Vida nocturna",
  "cat.family": "Familia",
  "cat.outdoor": "Aire libre",
  "cat.education": "Talleres",
  "cat.fashion": "Moda",
  "cat.culture": "Cultura",
  "cat.other": "Otros",
};

const fr: Dict = {
  "nav.discover": "Découvrir",
  "nav.events": "Événements",
  "nav.categories": "Catégories",
  "nav.destinations": "Destinations",
  "nav.myworld": "Mon Monde",
  "search.placeholder": "Rechercher événements, artistes, équipes, salles ou lieux",
  "cat.music": "Musique",
  "cat.sports": "Sport",
  "cat.theatre": "Théâtre",
  "cat.comedy": "Humour",
  "cat.festivals": "Festivals",
  "cat.cinema": "Cinéma",
  "cat.conferences": "Conférences",
  "cat.technology": "Technologie",
  "cat.exhibitions": "Expositions",
  "cat.attractions": "Attractions",
  "cat.food-drink": "Gastronomie",
  "cat.nightlife": "Vie nocturne",
  "cat.family": "Famille",
  "cat.outdoor": "Plein air",
  "cat.education": "Ateliers",
  "cat.fashion": "Mode",
  "cat.culture": "Culture",
  "cat.other": "Autres",
};

const de: Dict = {
  "nav.discover": "Entdecken",
  "nav.events": "Events",
  "nav.categories": "Kategorien",
  "nav.destinations": "Reiseziele",
  "nav.myworld": "Meine Welt",
  "search.placeholder": "Events, Künstler, Teams, Spielstätten oder Orte suchen",
  "cat.music": "Musik",
  "cat.sports": "Sport",
  "cat.theatre": "Theater",
  "cat.comedy": "Comedy",
  "cat.festivals": "Festivals",
  "cat.cinema": "Kino",
  "cat.conferences": "Konferenzen",
  "cat.technology": "Technologie",
  "cat.exhibitions": "Ausstellungen",
  "cat.attractions": "Attraktionen",
  "cat.food-drink": "Essen & Trinken",
  "cat.nightlife": "Nachtleben",
  "cat.family": "Familie",
  "cat.outdoor": "Outdoor",
  "cat.education": "Workshops",
  "cat.fashion": "Mode",
  "cat.culture": "Kultur",
  "cat.other": "Sonstiges",
};

const DICTS: Record<Locale, Dict> = { en, pt, es, fr, de };

export function translate(locale: string, key: string, fallback?: string): string {
  const l = (LOCALES as readonly string[]).includes(locale) ? (locale as Locale) : "en";
  return DICTS[l][key] ?? en[key] ?? fallback ?? key;
}
