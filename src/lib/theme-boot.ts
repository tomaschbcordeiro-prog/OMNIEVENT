export const THEME_KEY = "omnievent:theme";

/**
 * Run in <head> before the first paint, so a page never flashes the other theme, and the
 * opening scene (src/components/opening) covers the home page from the first frame instead of
 * appearing over it a moment later:
 * - "full": the first visit to the home page in this browser (or ?intro=1). Not for crawlers.
 * - "splash": the installed app, opened again (once per session).
 */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}try{if(location.pathname==="/"){var f=/[?&]intro=1/.test(location.search),sp=/[?&]intro=splash/.test(location.search),b=/bot|crawl|spider|slurp|headless|lighthouse|preview/i.test(navigator.userAgent),s=matchMedia("(display-mode: standalone)").matches;if(f||(!b&&!localStorage.getItem("mundivi:intro")))document.documentElement.setAttribute("data-intro","full");else if(sp||(s&&!sessionStorage.getItem("mundivi:splash")))document.documentElement.setAttribute("data-intro","splash")}}catch(e){}`;
