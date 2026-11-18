import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes, scrypt } from "node:crypto";
import { cmd, resetMemory } from "@/lib/community/kv";
import { memberId, memberOf, signIn, signUp, SESSION_IDLE_DAYS, SESSION_MAX_DAYS } from "@/lib/community/service";
import { checkHash, hashPassword, timesBreached } from "@/lib/community/passwords";
import { passwordProblem, PASSWORD_MIN } from "@/lib/community/password-rules";
import { obviouslyInside, privateAddress, publicAddresses, safeGet } from "@/lib/safe-fetch";
import { hasBearer, sameOrigin } from "@/lib/api";
import { pageCsp, API_CSP } from "@/lib/csp";

describe("new passwords (NIST SP 800-63B rev. 4)", () => {
  it("asks for at least 15 characters, counting emoji and spaces as people do", () => {
    expect(PASSWORD_MIN).toBe(15);
    expect(passwordProblem("fourteen chars")).toMatch(/15 characters \(1 more\)/);
    expect(passwordProblem("sardines at midnight")).toBeNull();
    expect(passwordProblem("🐟🌙 sardines porto")).toBeNull();
    expect(passwordProblem("x".repeat(129))).toMatch(/too long/);
  });

  it("has no rules about digits or symbols: a long phrase or a long random number is fine", () => {
    expect(passwordProblem("the quiet harbour at dawn")).toBeNull();
    expect(passwordProblem("839201746583920")).toBeNull();
    expect(passwordProblem("Gx7#pQ2!vL9@wZ4$")).toBeNull();
  });

  it("refuses what attackers try first: repeats, keyboard runs and common passwords dressed up", () => {
    for (const pw of [
      "aaaaaaaaaaaaaaaa",
      "abababababababab",
      "passwordpassword",
      "passwordpassword1!",
      "abc123abc123abc123",
      "123456789012345",
      "qwertyuiopasdfgh",
      "zyxwvutsrqponmlk",
      "1qaz2wsx3edc4rfv",
      "P@ssw0rd!!123456",
      "Benfica!1234567890",
      "iloveyouiloveyou",
      "Sporting 2026 !!!!",
    ])
      expect(passwordProblem(pw), pw).toMatch(/too easy/);
  });

  it("refuses the person's username or email and the site's name", () => {
    expect(passwordProblem("maria.costa is the best", { username: "maria.costa" })).toMatch(/username or email/);
    expect(passwordProblem("my mail mcosta88 again!", { email: "mcosta88@example.com" })).toMatch(/username or email/);
    expect(passwordProblem("I really love Mundivi trips")).toMatch(/site's name/);
  });
});

describe("breached passwords (Have I Been Pwned, k-anonymity)", () => {
  const sha = (s: string) => createHash("sha1").update(s).digest("hex").toUpperCase();

  it("sends only the first 5 characters of the hash, with padding, and finds the rest in the answer", async () => {
    const pw = "correct horse battery staple";
    const h = sha(pw);
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers as Record<string, string> });
      return new Response(`0000000000000000000000000000000000A:3\r\n${h.slice(5)}:1234\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0:0\r\n`);
    }) as typeof fetch;
    expect(await timesBreached(pw, fake)).toBe(1234);
    expect(calls[0].url).toBe(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`);
    expect(calls[0].url).not.toContain(h.slice(5));
    expect(calls[0].headers["Add-Padding"]).toBe("true");
  });

  it("says 0 when it isn't there, and doesn't hold anyone up when the service is down", async () => {
    expect(await timesBreached("a phrase nobody has ever used 7f3", (async () => new Response("ABCDEF:2\n")) as unknown as typeof fetch)).toBe(0);
    expect(await timesBreached("x", (async () => new Response("", { status: 503 })) as unknown as typeof fetch)).toBeNull();
    expect(await timesBreached("x", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe("storing passwords (scrypt, OWASP strength)", () => {
  const s1 = async (pw: string) => {
    const salt = randomBytes(16);
    const key = await new Promise<Buffer>((ok, no) => scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? no(e) : ok(k))));
    return `s1$${salt.toString("base64")}$${key.toString("base64")}`;
  };

  it("hashes with a fresh salt each time, and never stores the password", async () => {
    const a = await hashPassword("sardines at midnight");
    const b = await hashPassword("sardines at midnight");
    expect(a).toMatch(/^s2\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("sardines");
    expect(await checkHash("sardines at midnight", a)).toEqual({ ok: true, upgrade: false });
    expect(await checkHash("sardines at noon", a)).toEqual({ ok: false, upgrade: false });
    expect(await checkHash("anything", "garbage")).toEqual({ ok: false, upgrade: false });
  });

  it("still accepts the older, lighter hashes, and says they should be stored again", async () => {
    expect(await checkHash("old but gold", await s1("old but gold"))).toEqual({ ok: true, upgrade: true });
  });

  it("upgrades an older hash when its owner signs in", async () => {
    resetMemory();
    const p = await signUp("a".repeat(32), { firstName: "Rui", lastName: "Sá", username: "rui.sa", email: "rui@example.com", password: "a long walk by the river" }, "ip-u");
    const acct = JSON.parse((await cmd<string>(["GET", `c:acct:${p.id}`]))!);
    acct.pw = await s1("a long walk by the river");
    await cmd(["SET", `c:acct:${p.id}`, JSON.stringify(acct)]);
    await signIn("b".repeat(32), { login: "rui.sa", password: "a long walk by the river" }, "ip-u2");
    const after = JSON.parse((await cmd<string>(["GET", `c:acct:${p.id}`]))!);
    expect(after.pw).toMatch(/^s2\$/);
    expect((await signIn("c".repeat(32), { login: "rui.sa", password: "a long walk by the river" }, "ip-u3")).id).toBe(p.id);
  });
});

describe("sessions: signed out after 30 idle days, and 90 days after signing in", () => {
  beforeEach(() => {
    resetMemory();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());
  const day = 86_400_000;

  it("keeps a browser in while it's used, and lets it go after 30 days away", async () => {
    expect(SESSION_IDLE_DAYS).toBe(30);
    const phone = "p".repeat(32);
    const p = await signUp(phone, { firstName: "Inês", lastName: "Lopes", username: "ines.l", email: "ines@example.com", password: "orange trees in the patio" }, "ip-s");
    expect(await memberOf(phone)).toBe(p.id);
    vi.setSystemTime(Date.now() + 20 * day);
    expect(await memberOf(phone)).toBe(p.id);
    vi.setSystemTime(Date.now() + 25 * day); // 25 days after the last visit: still in
    expect(await memberOf(phone)).toBe(p.id);
    vi.setSystemTime(Date.now() + 31 * day); // 31 days away: out
    expect(await memberOf(phone)).toBe(memberId(phone));
  });

  it("ends every session 90 days after signing in, however often it's used", async () => {
    expect(SESSION_MAX_DAYS).toBe(90);
    const laptop = "l".repeat(32);
    const p = await signUp(laptop, { firstName: "Tiago", lastName: "Reis", username: "tiago.r", email: "tiago@example.com", password: "blue tiles on the old house" }, "ip-s2");
    for (let d = 10; d < 90; d += 10) {
      vi.setSystemTime(new Date("2026-01-01T12:00:00Z").getTime() + d * day);
      expect(await memberOf(laptop)).toBe(p.id);
    }
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z").getTime() + 90 * day);
    expect(await memberOf(laptop)).toBe(memberId(laptop));
  });

  it("treats an older session (account id only) as signed in from now", async () => {
    const tab = "t".repeat(32);
    await cmd(["SET", `c:sess:${memberId(tab)}`, "abc123", "EX", 86400 * 400]);
    expect(await memberOf(tab)).toBe("abc123");
    expect(await cmd(["GET", `c:sess:${memberId(tab)}`])).toMatch(/^abc123\|\d+\|\d+$/);
  });
});

describe("fetching other sites' pictures (no reaching inside)", () => {
  it("knows private, local, shared and reserved addresses, in every spelling", () => {
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
      "192.0.0.8", "192.0.2.1", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "255.255.255.255",
      "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
      "0:0:0:0:0:ffff:a9fe:a9fe", "64:ff9b::10.0.0.1", "2001:db8::1", "2002:7f00:1::", "2001:0:4136:e378::1", "::127.0.0.1",
      "not an ip",
    ])
      expect(privateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "151.101.1.69", "2606:4700:4700::1111", "2a00:1450:4003:80e::200e", "::ffff:8.8.8.8", "64:ff9b::8.8.8.8"])
      expect(privateAddress(ip), ip).toBe(false);
  });

  it("spots local-only names and numbered inside addresses without looking anything up", () => {
    for (const u of ["https://localhost/a.jpg", "https://LOCALHOST./a", "https://printer.local/x", "https://db.internal/x", "https://intranet/x", "https://169.254.169.254/x", "https://[::1]/x", "https://router.home.arpa/x"])
      expect(obviouslyInside(new URL(u)), u).toBe(true);
    for (const u of ["https://images.example.com/a.jpg", "https://8.8.8.8/a.jpg", "https://upload.wikimedia.org/x.jpg"]) expect(obviouslyInside(new URL(u)), u).toBe(false);
  });

  it("refuses a name if any of its addresses is inside (a name can't hide 127.0.0.1 behind a public one)", async () => {
    const dns = (v4: string[], v6: string[] = []) => ({ resolve4: async () => v4, resolve6: async () => v6 }) as never;
    await expect(publicAddresses("pics.example.com", dns(["93.184.216.34"]))).resolves.toEqual([{ address: "93.184.216.34", family: 4 }]);
    await expect(publicAddresses("rebind.example.com", dns(["93.184.216.34", "127.0.0.1"]))).rejects.toMatchObject({ code: "EPRIVATE" });
    await expect(publicAddresses("v6.example.com", dns(["93.184.216.34"], ["::1"]))).rejects.toMatchObject({ code: "EPRIVATE" });
    await expect(publicAddresses("nothing.example.com", dns([]))).rejects.toMatchObject({ code: "ENOTFOUND" });
  });

  it("refuses inside addresses, plain http, passwords in links and other ports before connecting", async () => {
    for (const u of ["https://127.0.0.1/a.jpg", "https://[::1]/a.jpg", "https://169.254.169.254/latest/meta-data", "https://[::ffff:7f00:1]/x", "http://example.com/a.jpg", "https://u:p@example.com/a.jpg", "https://example.com:8443/a.jpg"])
      await expect(safeGet(new URL(u)), u).rejects.toMatchObject({ code: "EPRIVATE" });
  });
});

describe("requests", () => {
  it("compares the scheduler's secret in constant time, and refuses without one", () => {
    const req = (auth?: string) => new Request("https://x/api/sync", { headers: auth ? { authorization: auth } : {} });
    expect(hasBearer(req("Bearer s3cret-value"), "s3cret-value")).toBe(true);
    expect(hasBearer(req("Bearer s3cret-valuX"), "s3cret-value")).toBe(false);
    expect(hasBearer(req("Bearer s3cret"), "s3cret-value")).toBe(false);
    expect(hasBearer(req(), "s3cret-value")).toBe(false);
    expect(hasBearer(req("Bearer "), undefined)).toBe(false);
  });

  it("refuses changes the browser says come from another site", () => {
    const r = new Request("https://mundivi.app/api/community", { method: "POST", body: "{}", headers: { host: "mundivi.app", "sec-fetch-site": "cross-site" } });
    expect(sameOrigin(r)).toBe(false);
    const ok = new Request("https://mundivi.app/api/community", { method: "POST", body: "{}", headers: { host: "mundivi.app", "sec-fetch-site": "same-origin", origin: "https://mundivi.app" } });
    expect(sameOrigin(ok)).toBe(true);
  });
});

describe("Content-Security-Policy", () => {
  it("lets only this response's scripts run: a nonce, strict-dynamic, no inline handlers, no eval", () => {
    const p = pageCsp("abc123");
    const script = p.split("; ").find((d) => d.startsWith("script-src "))!;
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
    expect(p).toContain("script-src-attr 'none'");
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("base-uri 'none'");
    expect(p).toContain("frame-ancestors 'none'");
    expect(pageCsp("n", true)).toContain("'unsafe-eval'");
    expect(API_CSP).toContain("default-src 'none'");
  });
});
