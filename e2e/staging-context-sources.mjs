// "About my business" (Settings > AI assistant) and the lead-source cards on staging, in a real browser, as a synthetic demo owner (quick self-check of rule 14). Staging only; made-up data (ABOUT_BUSINESS_SCREENS=mock, SOURCE_CARDS_SCREENS=mock).
//   node e2e/staging-context-sources.mjs [textiles|construction_materials|education] [desktop|phone]
// Checks: the notes box saves by itself and survives a reload; a pasted price list shows "Here is what I understood" and is saved only on the person's word; "Try it" answers from the notes and says when it would wait for the owner;
// the source cards: seven in order, the IndiaMART key box is a password box and only a hint comes back, the forwarding address and the website snippet appear; the Lead Desk loads.
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
  const notes = p.getByLabel("Your notes");
  await notes.waitFor({ timeout: 45000 });
  await sleep(1500);
  ok("About my business is on Settings > AI assistant", await p.locator('[data-part="about-business"]').isVisible());
  const stamp = `Delivery within the city. Check ${Date.now() % 100000}.`;
  await notes.fill(stamp);
  await p.locator('[data-save="saved"]').waitFor({ timeout: 15000 }).then(() => ok("the notes save by themselves", true), () => ok("the notes save by themselves", false));
  await shot(s, `cs-${pack}-${size}-1-notes`);
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.getByLabel("Your notes").waitFor({ timeout: 45000 });
  await sleep(1000);
  ok("they are still there after a reload", (await p.getByLabel("Your notes").inputValue()).includes(stamp.slice(0, 20)));
  // paste -> preview -> save on the person's word
  await p.getByRole("button", { name: "Paste text" }).click();
  await p.getByLabel("Paste text", { exact: true }).last().fill("Paver blocks: 38 rupees each. Payment: half in advance.");
  await p.getByRole("button", { name: "Read it" }).click();
  await p.getByText("Here is what I understood").waitFor({ timeout: 20000 }).then(() => ok("a pasted list shows 'Here is what I understood'", true), () => ok("a pasted list shows 'Here is what I understood'", false));
  const before = await p.getByLabel("Your notes").inputValue();
  ok("nothing is saved until the person says so", !before.includes("Paver blocks"));
  await shot(s, `cs-${pack}-${size}-2-preview`);
  await p.getByRole("button", { name: "Save these notes" }).click();
  await p.waitForFunction(() => document.querySelector("#ctx-notes")?.value.includes("Paver blocks"), null, { timeout: 15000 }).then(() => ok("saving the preview adds it to the notes", true), () => ok("saving the preview adds it to the notes", false));
  // try it
  await p.getByLabel("Try it", { exact: true }).fill("how much are paver blocks?");
  await p.getByRole("button", { name: "Ask", exact: true }).click();
  await p.getByText("It would answer:").or(p.getByText("It would not answer this by itself")).first().waitFor({ timeout: 20000 }).then(() => ok("'Try it' answers from the notes", true), () => ok("'Try it' answers", false));
  await shot(s, `cs-${pack}-${size}-3-tryit`);
  // versions
  await p.locator("details summary", { hasText: "Earlier versions" }).click();
  await p.getByText(/^Version \d+/).first().waitFor({ timeout: 15000 }).then(() => ok("earlier versions are listed", true), () => ok("earlier versions are listed", false));
  // source cards
  await p.goto(`${s.base}/lead-sources`, { waitUntil: "domcontentloaded" });
  await p.locator('[data-part="source-cards"]').waitFor({ timeout: 45000 });
  await sleep(1500);
  const kinds = await p.locator("[data-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-card")));
  ok("seven cards in the contract's order", kinds.join() === "meta,indiamart,email_forward,website,files,whatsapp,missed_calls", kinds.join());
  await shot(s, `cs-${pack}-${size}-4-cards`);
  const im = p.locator('[data-card="indiamart"]');
  await im.getByRole("button").first().click();
  const keyBox = p.getByLabel("Your IndiaMART CRM key");
  await keyBox.waitFor({ timeout: 10000 });
  ok("the key box is a password box", (await keyBox.getAttribute("type")) === "password");
  await keyBox.fill("synthetic-key-12345678");
  await p.getByRole("button", { name: "Save key" }).click();
  await p.getByText(/Key saved \(\.\.\.5678\)/).waitFor({ timeout: 15000 }).then(() => ok("only a hint of the key comes back", true), () => ok("only a hint of the key comes back", false));
  ok("the key is not left in the box", (await keyBox.inputValue()) === "");
  await p.locator('[data-card="email_forward"]').getByRole("button").first().click();
  await p.getByLabel("Your forwarding address").waitFor({ timeout: 15000 }).then(() => ok("the forwarding address appears", true), () => ok("the forwarding address appears", false));
  await p.locator('[data-card="website"]').getByRole("button").first().click();
  await p.getByLabel("Website snippet").waitFor({ timeout: 15000 }).then(() => ok("the website snippet appears", true), () => ok("the website snippet appears", false));
  await shot(s, `cs-${pack}-${size}-5-opened`);
  // Lead Desk still loads
  const r = await p.goto(`${s.base}/lead-desk`, { waitUntil: "domcontentloaded" });
  ok("the Lead Desk loads with the new filters", r?.status() === 200 && (await p.getByLabel("How urgent").count()) === 1);
  await shot(s, `cs-${pack}-${size}-6-desk`);
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
  await shot(s, `cs-${pack}-${size}-FAIL`).catch(() => null);
}
await s.browser.close();
process.exit(failed ? 1 : 0);
