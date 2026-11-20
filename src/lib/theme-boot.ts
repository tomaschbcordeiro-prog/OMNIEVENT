export const THEME_KEY = "omnievent:theme";

/**
 * Run in <head> before the first paint, so a page never flashes the other theme (the one picked
 * with the sun/moon button, else the device's own: day on a light phone, night on a dark one),
 * and the
 * opening scene (src/components/opening) covers the home page from the first frame instead of
 * appearing over it a moment later:
 * - "full": the first visit to the home page in this browser (or ?intro=1). Not for crawlers.
 * - "splash": the installed app, opened again (once per session).
 */
/** Also sets data-look="day" | "night" (what's showing, whichever way it was chosen) and keeps
 * it right when the theme or the device's setting changes: the day look's own styling hangs on it. */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}try{var r=document.documentElement,m=matchMedia("(prefers-color-scheme: dark)"),l=function(){var a=r.getAttribute("data-theme");r.setAttribute("data-look",a==="dark"||(a!=="light"&&m.matches)?"night":"day")};l();m.addEventListener("change",l);new MutationObserver(l).observe(r,{attributes:true,attributeFilter:["data-theme"]})}catch(e){}try{if(location.pathname==="/"){var f=/[?&]intro=1/.test(location.search),sp=/[?&]intro=splash/.test(location.search),b=/bot|crawl|spider|slurp|headless|lighthouse|preview/i.test(navigator.userAgent),s=matchMedia("(display-mode: standalone)").matches;if(f||(!b&&!localStorage.getItem("mundivi:intro")))document.documentElement.setAttribute("data-intro","full");else if(sp||(s&&!sessionStorage.getItem("mundivi:splash")))document.documentElement.setAttribute("data-intro","splash")}}catch(e){}`;
