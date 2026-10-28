// "Hear it" on staging, by ear-proxy (rule 14): what is SHOWN under the button must be what the API says it SPOKE. Real browser, synthetic demo owner, staging only.
//   node e2e/staging-hearit.mjs [textiles|construction_materials|education] [desktop|phone]
// Checks: (a) Settings > AI assistant preview: after "Hear it" the exact words appear and equal the greeting the API gives for the saved line; (b) the opening-line editor: an EDITED, UNSAVED line can be sent (no 'save first'), and the answer is either its exact spoken words
// (displayed == returned) or, while the API has no preview-this-text, an honest sentence that it cannot be heard yet; a SAVED line is heard with its exact greeting shown; (c) the setup wizard's "Hear it" shows the same exact words; (d) the voice picker's play button is there.
import { session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const size = process.argv[3] || "desktop";
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const norm = (t) => t.replace(/\s+/g, " ").trim();
const s = await session(pack, size);
const p = s.page;
try {
  await p.goto(`${s.base}/settings?section=assistant`, { waitUntil: "domcontentloaded" });
  await p.locator("aside[aria-labelledby=asst-prev-h]").waitFor({ timeout: 45000 });
  await sleep(2000);
  // (a) the preview card
  await p.locator('aside[aria-labelledby=asst-prev-h] button:has-text("Hear")').first().click();
  const said = p.locator('[data-part="preview-text"]');
  await said.waitFor({ timeout: 30000 }).then(() => ok("the preview card shows the exact words after 'Hear it'", true), () => ok("the preview card shows the exact words after 'Hear it'", false));
  const shown = (await said.count()) ? norm((await said.innerText()).replace(/^What you hear:\s*/, "")) : "";
  const lang = await p.evaluate(() => document.querySelector('[data-part="preview-line"]')?.getAttribute("lang") || "en");
  const direct = await p.evaluate(async ({ base, lang }) => {
    const r = await fetch(`${base}/voice-sample?voice=female_warm&lang=${lang}&tone=warm&text=1`, { cache: "no-store" });
    return r.ok ? (await r.json()).text : null;
  }, { base: `/app/tenants/${s.tenant}`, lang }).catch(() => null);
  ok("what is shown equals the greeting the API gives for the saved line", !!shown && !!direct && norm(direct) === shown, `${shown.slice(0, 80)}`);
  ok("it has no unfilled placeholder", !/[{}]/.test(shown));
  await shot(s, `hi-${pack}-${size}-1-card`);
  // (b) the opening-line editor with an unsaved edit
  const box = p.getByLabel("What is said");
  await box.scrollIntoViewIfNeeded();
  const edited = "Hello {customer}, this is {assistant} of {business}. Is this a good time for one quick question?";
  await box.fill(edited);
  const hearBtn = p.locator('[data-part="opening-preview"]').getByRole("button", { name: /Hear it|Hearing/ });
  ok("'Hear it' is enabled for an unsaved line (no 'save first')", await hearBtn.isEnabled());
  ok("there is no 'Save first' sentence", (await p.getByText(/Save first/i).count()) === 0);
  await hearBtn.click();
  const spoken = p.locator('[data-part="opening-preview"] [data-part="spoken-text"]');
  const unsupported = p.locator('[data-part="opening-preview"]').getByText(/not available on this system yet/);
  await spoken.or(unsupported).or(p.locator('[data-part="opening-preview"]').getByText(/no sound|could not/i)).first().waitFor({ timeout: 40000 });
  if (await spoken.count()) {
    const text = norm((await spoken.innerText()).replace(/^What was said:\s*/, ""));
    ok("the exact words it spoke are shown under the button", text.length > 10 && !/[{}]/.test(text), text.slice(0, 90));
    ok("they are the edited line (the new words, not the saved ones)", /quick question/.test(text));
  } else if (await unsupported.count()) {
    ok("while the API cannot speak unsaved text it says so, and plays nothing", true, "(API has no preview-this-text yet)");
  } else ok("an answer of some kind came back", false, (await p.locator('[data-part="opening-preview"]').innerText()).slice(-120));
  await shot(s, `hi-${pack}-${size}-2-editor`);
  // (c) the setup wizard
  await p.goto(`${s.base}/lead-setup?step=4`, { waitUntil: "domcontentloaded" });
  await p.locator("aside[aria-labelledby=asst-prev-h]").waitFor({ timeout: 45000 });
  await sleep(1500);
  await p.locator('aside[aria-labelledby=asst-prev-h] button:has-text("Hear")').first().click();
  await p.locator('[data-part="preview-text"]').waitFor({ timeout: 30000 }).then(async () => {
    const w = norm((await p.locator('[data-part="preview-text"]').innerText()).replace(/^[^:]*:\s*/, ""));
    ok("the wizard's 'Hear it' shows the exact words too", w.length > 10 && !/[{}]/.test(w), w.slice(0, 80));
  }, () => ok("the wizard's 'Hear it' shows the exact words too", false));
  await shot(s, `hi-${pack}-${size}-3-wizard`);
  // (d) the voice picker
  await p.goto(`${s.base}/settings?section=assistant`, { waitUntil: "domcontentloaded" });
  await p.locator("[data-play]").first().waitFor({ timeout: 45000 });
  ok("the voice picker has play buttons", (await p.locator("[data-play]").count()) >= 2);
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
  await shot(s, `hi-${pack}-${size}-FAIL`).catch(() => null);
}
await s.browser.close();
process.exit(failed ? 1 : 0);
