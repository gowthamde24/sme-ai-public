// The lead-source cards on staging against C1's REAL API (SOURCE_CARDS_SCREENS=1, not mock), as a synthetic demo owner (rule 14 quick self-check). Staging only.
//   node e2e/staging-cards-real.mjs [textiles|construction_materials|education] [desktop|phone]
// Checks: seven cards in the API's order with its own plain sentences; the forwarding address is the API's (…@leads.stack19.com) and is the SAME one after a reload (shown again); the Gmail steps show; missed calls say coming soon;
// WhatsApp not connected points to Integrations; no HTTP code or API term on any card; no page errors.
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
  await p.goto(`${s.base}/lead-sources`, { waitUntil: "domcontentloaded" });
  await p.locator('[data-part="source-cards"]').waitFor({ timeout: 45000 });
  await sleep(1500);
  const cards = await p.locator("[data-card]").evaluateAll((els) => els.map((e) => ({ kind: e.getAttribute("data-card"), status: e.getAttribute("data-status"), text: e.textContent || "" })));
  ok("seven cards in the API's order", cards.map((c) => c.kind).join() === "meta,indiamart,email_forward,website,files,whatsapp,missed_calls", cards.map((c) => c.kind).join());
  console.log(cards.map((c) => `${c.kind}=${c.status}`).join(" "));
  ok("no HTTP code or API word on a card", !cards.some((c) => /\b(40\d|50\d|HTTP|JSON|endpoint|token)\b/i.test(c.text)));
  const missed = cards.find((c) => c.kind === "missed_calls");
  ok("missed calls says coming soon", missed?.status === "coming_soon");
  await shot(s, `cr-${pack}-${size}-1-cards`);
  const mail = p.locator('[data-card="email_forward"]');
  const btn = mail.getByRole("button").first();
  if ((await btn.count()) === 0) {
    ok("the forwarding card has a button (mail door on)", false, (await mail.textContent())?.slice(0, 120));
  } else {
    await btn.click();
    const box = p.getByLabel("Your forwarding address");
    await box.waitFor({ timeout: 20000 });
    const first = await box.inputValue();
    ok("the forwarding address is the API's own", /@leads\.stack19\.com$/.test(first), first.replace(/^[^@]+/, "…"));
    ok("the Gmail steps show", (await mail.locator("ol li").count()) > 0);
    await shot(s, `cr-${pack}-${size}-2-address`);
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.locator('[data-part="source-cards"]').waitFor({ timeout: 45000 });
    await p.locator('[data-card="email_forward"]').getByRole("button").first().click();
    const again = await p.getByLabel("Your forwarding address").inputValue().catch(() => "");
    await p.getByLabel("Your forwarding address").waitFor({ timeout: 20000 });
    ok("the same address is shown again after a reload", (await p.getByLabel("Your forwarding address").inputValue()) === first);
  }
  const web = p.locator('[data-card="website"]');
  if (cards.find((c) => c.kind === "website")?.status !== "coming_soon" && (await web.getByRole("button").count()) > 0) {
    await web.getByRole("button").first().click();
    const got = await p.getByLabel("Website snippet").waitFor({ timeout: 15000 }).then(() => true, () => false);
    ok("the website card opens its snippet (or says why not in words)", got || (await web.getByRole("alert").count()) > 0);
    console.log("website panel:", got ? "snippet" : (await web.getByRole("alert").textContent().catch(() => "none")));
  }
  const wa = cards.find((c) => c.kind === "whatsapp");
  if (wa && wa.status !== "connected") ok("WhatsApp not connected points to Integrations", (await p.locator('[data-card="whatsapp"] a[href$="/integrations"]').count()) === 1);
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
  await shot(s, `cr-${pack}-${size}-FAIL`).catch(() => null);
}
await s.browser.close();
process.exit(failed ? 1 : 0);
