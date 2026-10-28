// The automatic-reply switch and the setup wizard's voice step on staging, in a real browser, as a synthetic demo owner (quick self-check of rule 14). Staging only; AUTO_REPLY_SCREENS=mock (the switch is a cookie, nothing is sent).
//   node e2e/staging-autoreply-wizard.mjs [textiles|construction_materials|education] [desktop|phone]
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
  await p.goto(`${s.base}/settings?section=assistant`, { waitUntil: "domcontentloaded" });
  const sec = p.locator('[data-part="auto-reply"]');
  await sec.waitFor({ timeout: 45000 });
  await sleep(1500);
  const text = await sec.innerText();
  ok("Automatic replies is on Settings > AI assistant, in plain words", /Automatic replies/.test(text) && /24 hours/.test(text) && /waits for you/.test(text) && /hands over/.test(text));
  ok("the three rules are listed", (await sec.locator("li").count()) === 3);
  const off = (await sec.locator("[data-state]").getAttribute("data-state")) === "off";
  if (!off) await sec.getByRole("button", { name: "Turn off automatic replies" }).click(), await sleep(1500);
  await shot(s, `ar-${pack}-${size}-1-off`);
  await sec.getByRole("button", { name: "Turn on automatic replies" }).click();
  await sec.getByText("Automatic replies are on.").waitFor({ timeout: 15000 }).then(() => ok("one tap turns it on", true), () => ok("one tap turns it on", false));
  ok("today's counts show while it is on", (await sec.locator('[data-part="auto-reply-today"]').count()) === 1);
  await shot(s, `ar-${pack}-${size}-2-on`);
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.locator('[data-part="auto-reply"]').waitFor({ timeout: 45000 });
  ok("it is still on after a reload", (await p.locator('[data-part="auto-reply"] [data-state]').getAttribute("data-state")) === "on");
  await p.locator('[data-part="auto-reply"]').getByRole("button", { name: "Turn off automatic replies" }).click();
  await p.locator('[data-part="auto-reply"]').getByText(/are off/).waitFor({ timeout: 15000 }).then(() => ok("one tap turns it off", true), () => ok("one tap turns it off", false));
  // the setup wizard's voice step
  await p.goto(`${s.base}/lead-setup?step=4`, { waitUntil: "domcontentloaded" });
  await p.getByText(/Voice/i).first().waitFor({ timeout: 45000 });
  await sleep(2000);
  const body = await p.locator("main").innerText();
  ok("the wizard offers the catalogue voices (a name and a tone)", /(Ramya|Janvi|Sanya|Disha|Sindhu|Esha|Meera|Divya|Prakash)/.test(body), body.match(/(Ramya|Janvi|Sanya|Disha)/)?.[0] ?? "none");
  ok("no old persona list in the wizard", !/Female · warm|Male · calm|Male · lively|Female · clear/.test(body) && !/Vijaya/.test(body));
  await shot(s, `ar-${pack}-${size}-3-wizard`);
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
  await shot(s, `ar-${pack}-${size}-FAIL`).catch(() => null);
}
await s.browser.close();
process.exit(failed ? 1 : 0);
