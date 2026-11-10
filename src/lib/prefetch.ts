/**
 * Which links are worth loading ahead when someone shows they're about to follow one (the
 * pointer rests on it, a finger touches it): the site's own pages that are built for each
 * visit, so they're ready, or nearly, by the time the click lands.
 */

/** Pages built per visit (events, venues, people, cities, categories, clubs), and the event lists. */
const AHEAD = /^\/(events|venues|participants|destinations|categories|clubs)(\/[^/]+)?\/?$/;
/** Pages that only redirect or have side effects. */
const NEVER = /^\/(events\/new|clubs\/new|studio|out|api|leaving)(\/|$)/;

/**
 * The address to load ahead for a link, or null when it isn't one: another site, the page
 * already showing, a file, a new tab, or a page that does something when opened.
 */
export function intentHref(href: string, here: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, here);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const path = url.pathname;
  if (NEVER.test(path) || !AHEAD.test(path)) return null;
  const now = new URL(here);
  if (path === now.pathname && url.search === now.search) return null;
  return path + url.search;
}

/** A link a person is about to follow, as far as loading ahead goes. */
export function linkAhead(a: HTMLAnchorElement, here: string, origin: string): string | null {
  if (a.target && a.target !== "_self") return null;
  if (a.hasAttribute("download") || a.dataset.noPrefetch != null) return null;
  return intentHref(a.getAttribute("href") ?? "", here, origin);
}
