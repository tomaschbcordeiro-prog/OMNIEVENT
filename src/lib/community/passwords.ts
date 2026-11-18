import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from "./password-rules";

/*
 * Passwords, after NIST SP 800-63B (rev. 4) and OWASP's Password Storage Cheat Sheet:
 * - New ones: at least 15 characters (any characters, spaces and emoji included; up to 128),
 *   no rules about digits or symbols, never a forced change.
 * - Refused: the ones attackers try first, ones made of the site's or the person's own name,
 *   simple runs and repeats, and any that has turned up in a known data breach (checked with
 *   Have I Been Pwned's range search, which only ever sees the first 5 characters of the
 *   password's SHA-1, never the password).
 * - Stored with scrypt (memory-hard), a random salt each, at OWASP's recommended strength.
 *   Older, lighter hashes are upgraded the next time their owner signs in.
 */

// OWASP: N=2^17, r=8, p=1, or the same work with less memory: here N=2^15, r=8, p=3 (32 MiB).
const S2 = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const S1 = { N: 2 ** 14, r: 8, p: 1 };

const derive = (pw: string, salt: Buffer, params: typeof S1 | typeof S2) =>
  new Promise<Buffer>((resolve, reject) => scrypt(pw, salt, 32, params, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `s2$${salt.toString("base64")}$${(await derive(pw, salt, S2)).toString("base64")}`;
}

/** Whether `pw` is the password stored as `stored`; `upgrade` when it should be hashed again. */
export async function checkHash(pw: string, stored: string): Promise<{ ok: boolean; upgrade: boolean }> {
  const [v, salt, hash] = String(stored ?? "").split("$");
  const params = v === "s2" ? S2 : v === "s1" ? S1 : undefined;
  if (!params || !salt || !hash) return { ok: false, upgrade: false };
  const got = await derive(pw, Buffer.from(salt, "base64"), params);
  const want = Buffer.from(hash, "base64");
  const ok = got.length === want.length && timingSafeEqual(got, want);
  return { ok, upgrade: ok && v !== "s2" };
}

const DUMMY_SALT = randomBytes(16);
/** The same work as checking a real password, for logins that don't exist (timing reveals nothing). */
export const wasteTime = (pw: string) => derive(pw, DUMMY_SALT, S2).then(() => undefined);

/**
 * How many times a password appears in known breaches (Have I Been Pwned, k-anonymity range
 * search with padding, so not even the length of the answer says which one was asked about).
 * Unknown (null) when the service can't be reached in time: signing up isn't held up by it.
 */
export async function timesBreached(pw: string, fetcher?: typeof fetch): Promise<number | null> {
  // Switched off where there's no internet to ask (the test suite).
  if (!fetcher && process.env.PASSWORD_BREACH_CHECK === "off") return null;
  const get = fetcher ?? fetch;
  const sha = createHash("sha1").update(pw, "utf8").digest("hex").toUpperCase();
  const prefix = sha.slice(0, 5);
  const rest = sha.slice(5);
  try {
    const res = await get(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "Mundivi-password-check" },
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    for (const line of (await res.text()).split("\n")) {
      const [suffix, count] = line.trim().split(":");
      if (suffix === rest) return Number(count) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}

/**
 * What's wrong with a new password (already normalised with NFKC, so the same password typed
 * on another keyboard still matches), or null when it may be used.
 */
export async function newPasswordProblem(pw: string, who: { username?: string; email?: string }, fetcher?: typeof fetch): Promise<string | null> {
  const problem = passwordProblem(pw, who);
  if (problem) return problem;
  const seen = await timesBreached(pw, fetcher);
  if (seen && seen > 0)
    return "That password has turned up in a data breach on another site, so attackers already have it. Choose a different one, like a few words that only you would put together.";
  return null;
}

export { PASSWORD_MIN, PASSWORD_MAX };
