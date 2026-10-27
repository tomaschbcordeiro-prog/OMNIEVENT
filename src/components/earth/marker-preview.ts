import { getCategory, groupOf, GROUP_HEX } from "@/lib/categories";
import { formatEventDate, formatEventTime, formatMoney } from "@/lib/format";
import type { Cluster, EventCard } from "@/lib/types";

/**
 * The hover preview attached to a map marker: a miniature event card built from the
 * cluster's real data (sample events come from the API; nothing here is invented).
 * Built with DOM APIs and textContent only, so event text can never inject markup.
 */

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const groupName = (g: string) => getCategory(g)?.name.split(" &")[0] ?? "Other";

function when(c: EventCard): string {
  if (c.eventType === "daily_attraction") return "Open daily";
  if (c.eventType === "multi_day" && Date.parse(c.start) < Date.now()) return "On now";
  const date = formatEventDate(c.start, c.timeZone).replace(/ \d{4}$/, "");
  return c.hoursUnknown ? date : `${date}, ${formatEventTime(c.start, c.timeZone)}`;
}

function price(c: EventCard): string | undefined {
  if (c.isFree) return "Free";
  if (c.fromPrice) return `From ${formatMoney(c.fromPrice.amount, c.fromPrice.currency)}`;
  return undefined;
}

function media(card: EventCard | undefined, group: string): HTMLElement {
  const box = el("div", "omni-card__media");
  const hex = GROUP_HEX[group] ?? GROUP_HEX.other;
  box.style.background = `linear-gradient(140deg, ${hex}33, ${hex}88)`;
  if (card?.imageUrl) {
    const img = el("img");
    img.src = card.imageUrl;
    img.alt = "";
    img.decoding = "async";
    // Missing or broken images fall back to the category gradient.
    img.onerror = () => img.remove();
    box.append(img);
  }
  return box;
}

function chip(group: string, text: string) {
  const c = el("span", "omni-card__chip");
  const dot = el("i");
  dot.style.background = GROUP_HEX[group] ?? GROUP_HEX.other;
  c.append(dot, document.createTextNode(text));
  return c;
}

function liveLine(text: string) {
  const p = el("p", "omni-card__live");
  p.append(el("span", "live-dot"), document.createTextNode(text));
  return p;
}

export function buildPreview(c: Cluster): HTMLElement {
  const root = el("div", "omni-card");
  const first = c.sample[0];
  const withImage = c.sample.find((s) => s.imageUrl) ?? first;

  if (c.count === 1 && first) {
    const g = groupOf(first.categorySlug);
    root.append(media(first, g));
    const body = el("div", "omni-card__body");
    body.append(chip(g, getCategory(first.categorySlug)?.name ?? groupName(g)));
    if (c.live) body.append(liveLine("On right now"));
    body.append(el("p", "omni-card__title", first.title));
    body.append(el("p", "omni-card__meta", when(first)));
    body.append(el("p", "omni-card__meta omni-card__muted", `${first.venueName}, ${first.city}`));
    const foot = el("div", "omni-card__foot");
    const p = price(first);
    if (p) foot.append(el("span", "omni-card__price", p));
    foot.append(el("span", "omni-card__hint", "Click for details"));
    body.append(foot);
    root.append(body);
    return root;
  }

  root.append(media(withImage, c.dominant));
  const body = el("div", "omni-card__body");
  const top = Object.entries(c.groups).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const chips = el("div", "omni-card__chips");
  for (const [g, n] of top) chips.append(chip(g, `${groupName(g)} ${n.toLocaleString("en")}`));
  body.append(el("p", "omni-card__title", c.label));
  body.append(el("p", "omni-card__meta", `${c.count.toLocaleString("en")} events here`));
  if (c.live) body.append(liveLine(`${c.live.toLocaleString("en")} on right now`));
  body.append(chips);
  if (first) {
    const next = el("p", "omni-card__next");
    next.append(el("span", "omni-card__muted", "Next: "), document.createTextNode(`${first.title}, ${when(first)}`));
    body.append(next);
  }
  const foot = el("div", "omni-card__foot");
  foot.append(el("span", "omni-card__hint", "Click to explore"));
  body.append(foot);
  root.append(body);
  return root;
}
