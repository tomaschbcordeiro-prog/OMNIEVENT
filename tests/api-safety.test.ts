import { describe, expect, it } from "vitest";
import { handler, readJson, redactSecrets, sameOrigin } from "@/lib/api";

const post = (body: string, headers: Record<string, string> = {}) => new Request("http://x/api", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

describe("reading request bodies", () => {
  it("accepts a JSON object", async () => {
    expect(await readJson(post('{"action":"create"}'))).toEqual({ action: "create" });
  });
  it("refuses bodies that are too big, not JSON or not an object", async () => {
    const big = await readJson(post(JSON.stringify({ a: "x".repeat(70000) })));
    expect(big).toBeInstanceOf(Response);
    expect((big as Response).status).toBe(413);
    expect(((await readJson(post("{nope"))) as Response).status).toBe(400);
    expect(((await readJson(post("[1,2,3]"))) as Response).status).toBe(400);
    expect(((await readJson(post("{}", { "content-length": "999999" }))) as Response).status).toBe(413);
  });
});

describe("hiding secrets in public status text", () => {
  it("masks keys in links and auth headers, and leaves the rest", () => {
    expect(redactSecrets("GET https://app.ticketmaster.com/x.json?apikey=abc123DEF&size=200 failed")).toBe("GET https://app.ticketmaster.com/x.json?apikey=[hidden]&size=200 failed");
    expect(redactSecrets("client_id=foo&client_secret=bar")).toBe("client_id=foo&client_secret=[hidden]");
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnop")).toBe("Authorization: Bearer [hidden]");
    expect(redactSecrets("HTTP 429 rate limited")).toBe("HTTP 429 rate limited");
  });
});

describe("refusing writes from other sites", () => {
  const req = (method: string, origin?: string) => new Request("https://omnievent.vercel.app/api/here", { method, headers: { host: "omnievent.vercel.app", ...(origin ? { origin } : {}) }, body: method === "GET" ? undefined : "{}" });
  it("lets the site's own pages, scripts and reads through", () => {
    expect(sameOrigin(req("POST", "https://omnievent.vercel.app"))).toBe(true);
    expect(sameOrigin(req("POST"))).toBe(true);
    expect(sameOrigin(req("GET", "https://evil.example"))).toBe(true);
  });
  it("refuses a write sent from another site", async () => {
    expect(sameOrigin(req("POST", "https://evil.example"))).toBe(false);
    expect(sameOrigin(req("POST", "null"))).toBe(false);
    const h = handler(async (r: Request) => new Response(r.method === "POST" ? "done" : "read"));
    expect((await h(req("POST", "https://evil.example"))).status).toBe(403);
    expect((await h(req("POST", "https://omnievent.vercel.app"))).status).toBe(200);
  });
});
