import "server-only";
import { Resolver } from "node:dns/promises";
import { request } from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";

/*
 * Fetching an address someone else gave us (an event's picture) without letting it reach
 * inside: only public internet addresses, checked on the very address the connection is
 * made to. Checking a name and then letting fetch() look it up again would leave a gap: a
 * name can answer "public" to the check and "127.0.0.1" a moment later (DNS rebinding).
 */

/** Addresses on private, local, shared, documentation or reserved networks. */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return (
      a === 0 || // "this" network
      a === 10 || // private
      a === 127 || // loopback
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local (cloud metadata lives here)
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
      (a === 192 && b === 88 && c === 99) || // 6to4 relay
      (a === 192 && b === 168) || // private
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a === 198 && b === 51 && c === 100) || // TEST-NET-2
      (a === 203 && b === 0 && c === 113) || // TEST-NET-3
      a >= 224 // multicast, reserved, broadcast
    );
  }
  const g = groups6(ip);
  if (!g) return true;
  const v4 = (hi: number, lo: number) => privateAddress([hi >> 8, hi & 255, lo >> 8, lo & 255].join("."));
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  // IPv4 inside IPv6: mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) are judged as that address.
  if (zero(0, 5) && g[5] === 0xffff) return v4(g[6], g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return v4(g[6], g[7]);
  // Otherwise only global unicast (2000::/3), less the special blocks inside it.
  if ((g[0] & 0xe000) !== 0x2000) return true; // ::, ::1, fc00::/7, fe80::/10, ff00::/8, 64:ff9b:1::/48, 100::/64…
  return (
    (g[0] === 0x2001 && g[1] < 0x200) || // IETF protocol assignments: Teredo, ORCHID, benchmarking
    (g[0] === 0x2001 && g[1] === 0xdb8) || // documentation
    g[0] === 0x2002 || // 6to4 (wraps an IPv4 address)
    (g[0] === 0x3fff && g[1] < 0x1000) // documentation (2024)
  );
}

/** An IPv6 address as its eight 16-bit groups (zone dropped, embedded IPv4 converted). */
function groups6(ip: string): number[] | undefined {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (isIP(s) !== 6) return undefined;
  const four = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (four) {
    const [a, b, c, d] = four.slice(1).map(Number);
    s = `${s.slice(0, -four[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const all = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return all.length === 8 ? all.map((x) => parseInt(x, 16)) : undefined;
}

// Names are resolved with the DNS client that doesn't use Node's small pool of worker threads
// (dns.lookup does): slow lookups there held up everything else using that pool.
const resolver = new Resolver({ timeout: 2000, tries: 1 });

/** All of a name's addresses, or an error when it has none, or any that isn't public. */
export async function publicAddresses(host: string, dns: Pick<Resolver, "resolve4" | "resolve6"> = resolver): Promise<LookupAddress[]> {
  const h = host.replace(/^\[|\]$/g, "");
  const family = isIP(h);
  const addrs: LookupAddress[] = family
    ? [{ address: h, family }]
    : await Promise.all([dns.resolve4(h).catch(() => [] as string[]), dns.resolve6(h).catch(() => [] as string[])]).then(([v4, v6]) => [
        ...v4.map((address) => ({ address, family: 4 })),
        ...v6.map((address) => ({ address, family: 6 })),
      ]);
  if (!addrs.length) throw Object.assign(new Error(`no address for ${h}`), { code: "ENOTFOUND" });
  if (addrs.some((a) => privateAddress(a.address))) throw Object.assign(new Error(`${h} is not a public address`), { code: "EPRIVATE" });
  return addrs;
}

/**
 * Clearly not on the public internet, without looking anything up: an address typed as numbers
 * that is private, or a local-only name (localhost, *.local, *.internal, a name without a dot).
 */
export function obviouslyInside(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (isIP(host)) return privateAddress(host);
  return !host.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(host);
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** For node:https: connects only to the addresses checked just now. */
function pinnedLookup(hostname: string, options: { all?: boolean }, cb: LookupCb) {
  publicAddresses(hostname).then(
    (addrs) => (options?.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family)),
    (err) => cb(err, ""),
  );
}

export type SafeResponse = { status: number; headers: IncomingHttpHeaders; body: AsyncIterable<Buffer>; cancel: () => void };

/**
 * One https GET (no redirects followed: the caller checks each hop) to a public address,
 * the connection made to the address that passed the check. Rejects with code EPRIVATE for
 * anything else.
 */
export function safeGet(url: URL, { headers = {}, timeoutMs = 5000 }: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
      reject(Object.assign(new Error("only plain https addresses"), { code: "EPRIVATE" }));
      return;
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    // An address typed as numbers is never looked up, so it's checked here.
    if (isIP(host) && privateAddress(host)) {
      reject(Object.assign(new Error(`${host} is not a public address`), { code: "EPRIVATE" }));
      return;
    }
    const req = request(
      { host, port: 443, path: `${url.pathname}${url.search}`, method: "GET", headers, lookup: pinnedLookup as never, servername: isIP(host) ? undefined : host, timeout: timeoutMs },
      (res) => {
        // The clock keeps running while the picture comes in; it stops once it's all here.
        res.once("close", () => clearTimeout(timer));
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res, cancel: () => res.destroy() });
      },
    );
    // The whole answer, body included, not just each pause in it, has to come in time.
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("timed out"), { name: "TimeoutError", code: "ETIMEDOUT" })), timeoutMs);
    req.on("timeout", () => req.destroy(Object.assign(new Error("timed out"), { name: "TimeoutError", code: "ETIMEDOUT" })));
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}
