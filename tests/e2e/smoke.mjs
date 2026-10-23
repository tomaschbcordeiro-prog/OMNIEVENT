/**
 * End-to-end smoke test of the main user flows against a running server.
 *   npm run build && npm start   (in another terminal)
 *   node tests/e2e/smoke.mjs [baseUrl]
 * Uses PLAYWRIGHT_CHROMIUM if set, else Playwright's bundled Chromium.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const results = [];
const errors = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message.split("\n")[0]]);
  }
}
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));

await step("home loads with globe canvas and search", async () => {
  await page.goto(BASE + "/");
  await page.getByRole("combobox").first().waitFor();
  await page.locator("canvas").first().waitFor({ timeout: 30000 });
});

await step("natural-language search applies structured filters", async () => {
  const box = page.getByRole("combobox").first();
  await box.fill("Concerts in Lisbon next month");
  await box.press("Enter");
  await page.waitForFunction(() => location.search.includes("city=lisbon") && location.search.includes("cat=music"));
  await page.getByText(/Showing .*Lisbon, Portugal/).waitFor();
});

await step("autocomplete suggests destinations", async () => {
  const box = page.getByRole("combobox").first();
  await box.fill("tok");
  await page.getByRole("option", { name: /Tokyo/ }).first().waitFor();
  await box.press("Escape");
});

await step("2D map: cluster opens list, event opens preview with offers", async () => {
  await page.goto(BASE + "/?view=map&v=38.72,-9.14,0.3");
  const marker = page.getByRole("application").locator("button[aria-label$='events'], button[aria-label$='event']").first();
  await marker.waitFor({ timeout: 20000 });
  // Keyboard activation: markers are real buttons, reachable without a mouse.
  await marker.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: /Events here|Event preview/ });
  await panel.waitFor();
  if (await page.getByRole("complementary", { name: "Events here" }).count()) {
    await panel.locator("li button").first().focus();
    await page.keyboard.press("Enter");
  }
  await page.getByRole("complementary", { name: "Event preview" }).waitFor();
  await page.getByRole("link", { name: "View details" }).waitFor();
});

let eventUrl;
await step("event detail page: save, ticket table, demo checkout explained", async () => {
  await page.getByRole("link", { name: "View details" }).click();
  await page.waitForURL(/\/events\//);
  eventUrl = page.url();
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.getByText("This is a fictional demo event.").waitFor();
  const save = page.getByRole("button", { name: /^Save / }).first();
  await save.click();
  await page.getByRole("button", { name: /Remove .* from saved/ }).first().waitFor();
});

await step("ticket link goes through /out to the demo explanation (no fake checkout)", async () => {
  const res = await page.request.get(BASE + "/api/events?size=1&access=ticketed&status=on_sale");
  const slug = (await res.json()).items[0].slug;
  await page.goto(`${BASE}/events/${slug}#tickets`);
  await page.getByRole("link", { name: "View demo offer" }).first().click();
  await page.waitForURL(/\/demo-ticket/);
  await page.getByText("This is where you'd go to the seller").waitFor();
});

await step("My World shows the saved event; trip planner creates a trip with it", async () => {
  await page.goto(BASE + "/my-world?tab=saved");
  await page.locator("main li a[href^='/events/']").first().waitFor();
  await page.goto(BASE + "/my-world?tab=trips");
  await page.getByLabel("New trip").fill("Test trip");
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("button", { name: "Add" }).first().click();
  await page.getByRole("link", { name: "Tickets" }).first().waitFor();
});

await step("events page: category chip updates URL and results", async () => {
  await page.goto(BASE + "/events");
  await page.getByRole("group", { name: "Quick categories" }).getByRole("button", { name: /Sports/ }).click();
  await page.waitForURL(/cat=sports/);
  await page.getByRole("button", { name: /Remove filter Sports/ }).waitFor();
});

await step("desktop hides mobile filter button; mobile shows it", async () => {
  assert.equal(await page.getByRole("button", { name: /^Filters/ }).isVisible(), false);
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(BASE + "/events");
  assert.equal(await m.getByRole("button", { name: /^Filters/ }).isVisible(), true);
  await m.close();
});

await step("unknown event returns 404", async () => {
  const r = await page.request.get(BASE + "/events/definitely-not-real");
  assert.equal(r.status(), 404);
});

await step("invalid API params return a predictable 400", async () => {
  const r = await page.request.get(BASE + "/api/events?min=9&max=1");
  assert.equal(r.status(), 400);
  assert.equal((await r.json()).error.code, "invalid_params");
});

await browser.close();
for (const r of results) console.log(r.join("  "));
if (errors.length) console.log("Page errors:", errors);
process.exit(results.some((r) => r[0] === "FAIL") || errors.length ? 1 : 0);
