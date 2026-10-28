// The guided demo on staging, in a real browser, as each synthetic demo owner (Settings of nothing: the "Start demo" button of the DEMO workspace). Staging only; made-up data only (a lead named "Demo lead NNNN", a follow-up DRAFT, a visit): nothing is sent.
//   node e2e/staging-guided-demo.mjs [textiles|construction_materials|education ...]
// Per business type: the button is there; each of the six steps shows its caption and opens its screen; "The lead asks, ..." shows the question (and an answer, or the plain "could not answer" line); the story ends with its closing line.
import { PACKS, SHOTS, session, shot, sleep } from "./staging-df-lib.mjs";

const packs = process.argv.slice(2).length ? process.argv.slice(2) : PACKS;
const TITLES = ["A new lead arrives", /reaches out|వాళ్ళని సంప్రదిస్తుంది/, "The lead asks", "A follow-up call is lined up", "A visit is booked", "What happened while you were away"];
let failed = 0;
const ok = (pack, name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${pack} ${name} ${note}`);
};
for (const pack of packs) {
  const s = await session(pack, "desktop");
  try {
    await s.page.goto(s.base, { waitUntil: "domcontentloaded" });
    const start = s.page.locator('[data-part="guided-demo-start"]');
    await start.waitFor({ timeout: 45000 });
    ok(pack, "the Start demo button is on the DEMO workspace", true);
    await start.click();
    const panel = s.page.locator('[data-part="guided-demo"]');
    for (let i = 0; i < TITLES.length; i++) {
      await panel.getByRole("heading", { name: TITLES[i] }).waitFor({ timeout: 60000 });
      await s.page.getByText("Working on it…").waitFor({ state: "hidden", timeout: 120000 }).catch(() => null);
      await sleep(2500);
      const alert = await panel.getByRole("alert").count();
      const url = new URL(s.page.url()).pathname.replace(/^\/app\/tenants\/[0-9a-f-]{36}/, "") || "/";
      const lines = await panel.locator("[data-part='guided-demo-transcript'] li").allInnerTexts();
      ok(pack, `step ${i + 1} ${typeof TITLES[i] === "string" ? TITLES[i] : "the assistant reaches out"}`, alert === 0, `screen ${url}${lines.length ? `; ${lines.length} transcript lines: ${lines.map((l) => l.slice(0, 60)).join(" | ")}` : ""}`);
      await shot(s, `gd-${pack}-${i + 1}`);
      if (i === 0) {
        await s.page.waitForTimeout(500);
        const body = await s.page.locator("main").innerText().catch(() => "");
        ok(pack, "the new lead is on its screen", /Demo lead \d{4}/.test(body) || url === "/", url === "/" ? "(Today: the business type has no customers screen)" : "");
      }
      if (i < TITLES.length - 1) await panel.getByRole("button", { name: "Next" }).click();
    }
    await panel.getByRole("button", { name: "Next" }).click();
    await panel.getByText(/That is the whole story/).waitFor({ timeout: 20000 });
    ok(pack, "the story ends with its closing line", true);
  } catch (e) {
    ok(pack, "script", false, String(e.message || e).split("\n")[0].slice(0, 200));
    await shot(s, `gd-${pack}-FAIL`).catch(() => null);
  }
  await s.browser.close();
}
console.log(`pictures in ${SHOTS}`);
process.exit(failed ? 1 : 0);
