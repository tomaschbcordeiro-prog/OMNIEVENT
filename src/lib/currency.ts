import type { CurrencyCode } from "./types";

/**
 * Currency conversion is used ONLY to (a) apply a price filter across currencies
 * and (b) show "≈" estimates next to the provider's own price. Provider prices
 * are always displayed in their original currency first.
 *
 * These are STATIC, APPROXIMATE reference rates bundled with the app — they are
 * not live market data. Set FX_PROVIDER_URL to plug in a live rates service
 * (see src/lib/providers/README.md). The UI labels every converted figure.
 */
export const FX_SOURCE = {
  name: "Bundled approximate reference table (static, not live)",
  asOf: "2026-01-01",
  live: false,
};

// Units of currency per 1 USD (approximate).
const PER_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CHF: 0.88,
  DKK: 6.9,
  SEK: 10.6,
  NOK: 10.8,
  PLN: 4.0,
  CZK: 23.3,
  HUF: 365,
  TRY: 34,
  CAD: 1.37,
  MXN: 18.5,
  BRL: 5.6,
  ARS: 1000,
  CLP: 950,
  COP: 4100,
  PEN: 3.75,
  JPY: 150,
  KRW: 1380,
  CNY: 7.2,
  HKD: 7.8,
  TWD: 32,
  SGD: 1.34,
  THB: 35,
  IDR: 16000,
  PHP: 57,
  INR: 84,
  AED: 3.67,
  ILS: 3.7,
  ZAR: 18.2,
  EGP: 49,
  MAD: 10,
  KES: 129,
  NGN: 1600,
  GHS: 15,
  AUD: 1.52,
  NZD: 1.68,
};

export const SUPPORTED_CURRENCIES = Object.keys(PER_USD);

export function isCurrency(code: string): code is CurrencyCode {
  return /^[A-Z]{3}$/.test(code) && code in PER_USD;
}

/** Returns undefined when either currency is unknown — never guesses. */
export function convert(amount: number, from: CurrencyCode, to: CurrencyCode): number | undefined {
  if (from === to) return amount;
  const a = PER_USD[from];
  const b = PER_USD[to];
  if (!a || !b) return undefined;
  return (amount / a) * b;
}
