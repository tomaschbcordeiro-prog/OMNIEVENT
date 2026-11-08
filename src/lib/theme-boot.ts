export const THEME_KEY = "omnievent:theme";

/** Run in <head> before the first paint, so a page never flashes the other theme. */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
