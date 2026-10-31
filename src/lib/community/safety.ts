/**
 * Community safety rules, shared by the server (which enforces them) and the composer (which
 * warns while you type).
 */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
const HANDLE_RE = /\b(?:whats\s?app|wa\.me|telegram|t\.me\/|signal\s+me|dm\s+me\s+on|snap(?:chat)?\s*[:@])/i;
const SOLD_OUT_RE = /\b(?:sold|sell(?:ing)?)\s+out\b|esgotad[oa]s?|agotad[oa]s?/gi;
const SELLING_RE = /\b(?:sell(?:ing)?|for sale|vend[eo]|vendo|venda|à venda|a la venta|vendre|verkaufe|swap(?:ping)?|troco|cambio)\b/i;
const TICKETS_RE = /\b(?:tickets?|bilhetes?|entradas?|billetes?|billets?|ingressos?|karten)\b/i;
const PAYMENT_RE = /\b(?:mb\s?way|paypal|iban|bizum|revolut|venmo|cash\s?app|wise\s+transfer)\b/i;

/** A phone number: nine or more digits in groups of three or more (or starting with +), not dates or years. */
export function hasPhone(text: string): boolean {
  for (const m of text.matchAll(/\+?\(?\d[\d\s().-]{7,}\d/g)) {
    const c = m[0];
    const digits = c.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) continue;
    const groups = c.split(/[\s().+-]+/).filter(Boolean);
    if (groups.every((g) => /^(?:19|20)\d\d$/.test(g))) continue;
    if (c.startsWith("+") || groups.every((g) => g.length >= 3)) return true;
  }
  return false;
}

/**
 * Rules that keep conversations safe: no phone numbers, emails or messaging handles in public
 * (people meet through the site, not in private chats with strangers), and no selling or
 * swapping tickets, the usual way fans get scammed. Returns the reason, if any.
 */
export function safetyProblem(text: string): string | undefined {
  if (EMAIL_RE.test(text) || hasPhone(text) || HANDLE_RE.test(text))
    return "For your safety, don't share phone numbers, emails or messaging handles here. Agree on a public place to meet instead.";
  const t = text.replace(SOLD_OUT_RE, " ");
  if ((SELLING_RE.test(t) && TICKETS_RE.test(t)) || PAYMENT_RE.test(t))
    return "Selling, swapping or paying for tickets isn't allowed here: it's how fans get scammed. Use the official seller or its resale platform.";
  return undefined;
}
