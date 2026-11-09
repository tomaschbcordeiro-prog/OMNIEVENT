"use client";

/**
 * Opening an event from a list, the way apps do it: the picture tapped grows into the event
 * page's main picture while the rest of the page crossfades (the browser's View Transitions;
 * Chrome, Edge and Safari). Elsewhere, or when the visitor prefers less motion, it's an
 * ordinary navigation. Returns false when it left the click to the browser.
 */
type Router = { push: (href: string) => void };

export function openWithMorph(e: React.MouseEvent<HTMLAnchorElement>, router: Router): boolean {
  // New tab, new window, download: the browser's business.
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<void> } };
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const link = e.currentTarget;
  const href = link.getAttribute("href");
  if (!href?.startsWith("/events/")) return false;
  e.preventDefault();
  // The picture that will grow (the list's poster or photo). On an event page (its strips of
  // other events), that page's own main picture gives up the name for the moment: two
  // pictures can't carry it at once.
  const pic = link.querySelector<HTMLElement>("img, .poster-art");
  const heroes = [...document.querySelectorAll<HTMLElement>(".event-hero")];
  heroes.forEach((h) => (h.style.viewTransitionName = "none"));
  if (pic) pic.style.viewTransitionName = "event-hero";
  const path = href.split(/[?#]/)[0];
  const t = doc.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        // The old page has been captured: names back as they were, so the new page's main
        // picture is the only one called "event-hero".
        if (pic) pic.style.viewTransitionName = "";
        heroes.forEach((h) => (h.style.viewTransitionName = ""));
        router.push(href);
        // Done when the new page is on screen (its main picture is there), and no later than
        // 700 ms: past that the screen would look frozen, so the change goes on anyway.
        const started = Date.now();
        const check = () => {
          if ((location.pathname === path && document.querySelector("[data-event-hero]")) || Date.now() - started > 700) {
            clearInterval(timer);
            resolve();
          }
        };
        const timer = setInterval(check, 16);
      }),
  );
  t.finished.catch(() => {});
  return true;
}
