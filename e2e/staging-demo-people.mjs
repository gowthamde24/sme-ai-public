// Realistic made-up people for the demo workspaces on staging (owner review, 1 Nov): the demo owner has a name and a way to be addressed ("Good morning, Lakshmi"), and the leads that wait on Today are people, never "Demo lead 4485". Staging only, synthetic data only.
//   node e2e/staging-demo-people.mjs [textiles|construction_materials|education]
// 1. My profile: the name and "How should I address you?" of the pack's demo owner.  2. Old "Demo lead NNNN" requests that wait are approved (nothing dials; it is only recorded) so that they leave Today.
// 3. The guided demo is played to its end (it makes a new lead with a made-up name and what follows from it).  4. Needs you is read: no row carries "Demo lead".
import { session, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const PEOPLE = { textiles: ["Lakshmi Prasad", "Lakshmi"], construction_materials: ["Ravi Kumar", "Ravi"], education: ["Anitha Reddy", "Anitha"] };
const [fullName, callName] = PEOPLE[pack];
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const s = await session(pack, "desktop");
const p = s.page;
try {
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(`${s.base}/settings?section=profile`, { waitUntil: "domcontentloaded" });
  await p.locator("#me-name").waitFor({ timeout: 45000 });
  await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await sleep(2000);
  await p.locator("#me-name").fill(fullName);
  if ((await p.locator("#me-address").count()) === 1) await p.locator("#me-address").fill(callName);
  await p.locator('[data-part="my-profile"] form:has(#me-name) button[type="submit"]').click();
  await p.locator('[data-part="my-profile"] [role="status"]').first().waitFor({ timeout: 20000 });
  ok(`${pack}: the owner's name and how to address them are saved`, true, `${fullName} / ${callName}`);

  // the old made-up requests leave Today
  await p.goto(s.base, { waitUntil: "domcontentloaded" });
  await p.locator("#needs-you").waitFor({ timeout: 45000 });
  for (let i = 0; i < 8; i++) {
    await sleep(2500);
    const row = p.locator('[data-needs-row]:has-text("Demo lead")').first();
    if ((await row.count()) === 0) break;
    await row.getByRole("button", { name: /^Approve/ }).first().click().catch(() => null);
    await sleep(2500);
    await p.goto(s.base, { waitUntil: "domcontentloaded" });
    await p.locator("#needs-you").waitFor({ timeout: 45000 });
  }

  // play the guided demo to its end; two rows with the same made-up name look silly, so the later one is approved away and the demo plays once more (at most three times)
  let rows = [];
  const play = async () => {
    await p.locator('[data-part="guided-demo-start"]').click({ timeout: 20000 });
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      const done = await p.locator('[data-part="guided-demo"]').getByText(/whole story/i).count().catch(() => 0);
      if (done) break;
      const next = p.locator('[data-part="guided-demo"] button:has-text("Next")');
      if ((await next.count()) > 0 && (await next.first().isEnabled().catch(() => false)) && Date.now() - t0 > 20000) await next.first().click().catch(() => null);
      await sleep(3000);
      if (!(await p.locator('[data-part="guided-demo"]').count())) break;
    }
    const close = p.locator('[data-part="guided-demo"] button[aria-label="Close the demo"]').first();
    if ((await close.count()) > 0) await close.click().catch(() => null);
    await p.goto(s.base, { waitUntil: "domcontentloaded" });
    await p.locator("#needs-you").waitFor({ timeout: 45000 });
    await sleep(2500);
    rows = await p.locator("[data-needs-row]").allInnerTexts();
    console.log(`Needs you rows: ${JSON.stringify(rows.map((r) => r.replace(/\s+/g, " ")))}`);
    ok("no row says 'Demo lead' (people have names)", !rows.some((r) => /Demo lead/.test(r)));

  };
  for (let round = 0; round < 3; round++) {
    await play();
    const names = rows.map((r) => r.replace(/\s+/g, " ").replace(/^\S+\s/, "").split(" asked")[0].split(" కాల్")[0]);
    const dup = names.findIndex((n, i) => names.indexOf(n) !== i);
    if (dup < 0 || rows.length < 2) break;
    await p.locator("[data-needs-row]").nth(dup).getByRole("button", { name: /^(Approve|ఓకే)/ }).first().click().catch(() => null);
    await sleep(3000);
  }
  const h1 = await p.locator('[data-screen="today"] h1').innerText();
  ok(`the greeting says ${callName}`, h1.includes(callName), h1.replace(/\n/g, " "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 220));
}
await s.browser.close();
process.exit(failed ? 1 : 0);
