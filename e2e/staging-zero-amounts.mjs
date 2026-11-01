// Assistant answers never read out a zero amount (owner review, 1 Nov, item 8), asked through the Today composer on staging as a synthetic demo owner. Staging only.
//   node e2e/staging-zero-amounts.mjs [textiles|construction_materials|education] [en|te]
import { session, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "construction_materials";
const lang = process.argv[3] || "en";
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const s = await session(pack, "desktop");
const p = s.page;
try {
  if (lang !== "en") await s.context.addCookies([{ name: "sme_lang", value: lang, url: "https://staging.stack19.com" }]);
  await p.setViewportSize({ width: 1440, height: 900 });
  for (const q of ["How much customer money is held?", "How many new enquiries came today?"]) {
    await p.goto(s.base, { waitUntil: "domcontentloaded" });
    await p.locator("#chat-input").waitFor({ timeout: 45000 });
    await sleep(2000);
    await p.locator("#chat-input").fill(q);
    await p.locator('[data-part="command-bar"] button[type="submit"]').click();
    await p.locator('[data-chat="assistant"]').last().waitFor({ timeout: 60000 });
    await sleep(8000);
    const text = (await p.locator('[data-chat="assistant"]').last().innerText()).replace(/\s+/g, " ");
    console.log(`  Q: ${q}\n  A: ${text.slice(0, 220)}`);
    ok(`no zero amount or "0 ..." read out: ${q}`, !/₹\s?0(\.00)?\b|\b0 (orders|enquiries|leads|messages)\b/.test(text));
  }
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
}
await s.browser.close();
process.exit(failed ? 1 : 0);
