import { countryName, planHref, THEME_HUE, THEMES, type TripIdea } from "./ideas";
import { flagOf } from "../trip";

/** A trip idea as a card shows it: plain data, so a page's script needn't carry every place on Earth. */
export interface IdeaCardData {
  key: string;
  href: string;
  title: string;
  emoji: string;
  theme?: { emoji: string; label: string };
  hue: number;
  stops: { name: string; nights: number; lat: number; lng: number }[];
  nights: number;
  km: number;
  flags: string;
  countries: string;
}

export function ideaCards(ideas: TripIdea[]): IdeaCardData[] {
  return ideas.map((i) => {
    const theme = THEMES.find((t) => t.key === i.theme);
    return {
      key: i.key,
      href: planHref(i),
      title: i.title,
      emoji: i.emoji,
      theme: theme ? { emoji: theme.emoji, label: theme.label } : undefined,
      hue: THEME_HUE[i.theme],
      stops: i.stops.map((s) => ({ name: s.place.name, nights: s.nights, lat: s.place.lat, lng: s.place.lng })),
      nights: i.nights,
      km: i.km,
      flags: i.countries.map(flagOf).join(" "),
      countries: i.countries.map(countryName).join(", "),
    };
  });
}
