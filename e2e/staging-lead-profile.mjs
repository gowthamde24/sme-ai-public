// The lead page's "What they want" card against C1's REAL API (rule 14 quick self-check), as a synthetic demo owner. Staging only.
//   node e2e/staging-lead-profile.mjs [textiles|construction_materials|education] [desktop|phone]
// Checks: a lead with a profile shows the card; a guessed field has a "?" and "That is right" removes it for good (after a reload); "Change" saves a typed value; no page errors.
import { session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const size = process.argv[3] || "desktop";
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const s = await session(pack, size);
const p = s.page;
try {
  await p.goto(`${s.base}/lead-desk`, { waitUntil: "domcontentloaded" });
  await sleep(3000);
  const hrefs = [...new Set(await p.locator('a[href*="/leads/"]').evaluateAll((a) => a.map((x) => x.getAttribute("href"))))].filter((h) => /\/leads\/[0-9a-f-]{36}/.test(h || ""));
  console.log(`${hrefs.length} lead links`);
  let found = null;
  for (const h of hrefs.slice(0, 12)) {
    await p.goto(new URL(h, s.base).href.split("?")[0] + "?section=overview", { waitUntil: "domcontentloaded" });
    await sleep(1200);
    if ((await p.locator('[data-part="lead-profile"] [data-guessed="1"]').count()) > 0) {
      found = h;
      break;
    }
  }
  ok("a lead shows the What they want card with a guessed field", !!found, found ?? "none of the first 12 leads has one");
  if (found) {
    await shot(s, `lp-${pack}-${size}-1-card`);
    const guessed = p.locator('[data-part="lead-profile"] [data-guessed="1"]').first();
    const field = await guessed.getAttribute("data-field");
    await guessed.locator('[data-act="confirm"]').click();
    await sleep(2500);
    await p.reload({ waitUntil: "domcontentloaded" });
    await sleep(1200);
    const after = await p.locator(`[data-part="lead-profile"] [data-field="${field}"]`).getAttribute("data-guessed");
    ok(`"That is right" on ${field} removes the ? and it stays after a reload`, after === "0", `data-guessed=${after}`);
    const row = p.locator(`[data-part="lead-profile"] [data-field="${field}"]`);
    if (field !== "urgency") {
      await row.locator('[data-act="change"]').click();
      await row.getByRole("textbox").fill("Test town");
      await row.getByRole("button", { name: "Save" }).click();
      await p.locator(`[data-part="lead-profile"] [data-field="${field}"]`).getByText("Test town").waitFor({ timeout: 15000 }).then(() => null, () => null);
      const txt = (await p.locator(`[data-part="lead-profile"] [data-field="${field}"]`).textContent()) ?? "";
      ok("Change saves the typed value", txt.includes("Test town"), txt.slice(0, 80));
    }
    await shot(s, `lp-${pack}-${size}-2-fixed`);
  }
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
  await shot(s, `lp-${pack}-${size}-FAIL`).catch(() => null);
}
await s.browser.close();
process.exit(failed ? 1 : 0);
