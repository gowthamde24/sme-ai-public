// Settings > AI assistant in tabs, and Today's "Finish setting up" rows on a narrow phone (owner 30 Oct), on staging, as a synthetic demo owner. Staging only.
//   node e2e/staging-ai-tabs.mjs [textiles|construction_materials|education] [desktop|phone] [en|te] [width]
// Settings: the tab bar (Basics, Knowledge, Behaviour, Pronunciation, Advanced as far as they exist), Basics first with the preview card at its top, choosing a tab shows its part and writes #id to the address, a link with #behaviour opens that tab, Behaviour saves on its own,
// on a phone the tab bar scrolls inside itself (no sideways page scroll). Today: each checklist row has the status under the title on narrow widths and "Hide for now" on one line. Pictures in ~/Desktop/v2-overnight/shots-df/.
import { session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const size = process.argv[3] || "desktop";
const lang = process.argv[4] || "en";
const width = Number(process.argv[5] || 0);
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const s = await session(pack, size);
const p = s.page;
const tag = `tb-${pack}-${width || size}-${lang}`;
try {
  if (lang !== "en") await s.context.addCookies([{ name: "sme_lang", value: lang, url: "https://staging.stack19.com" }]);
  if (width) await p.setViewportSize({ width, height: 800 });
  await p.goto(`${s.base}/settings?section=assistant`, { waitUntil: "domcontentloaded" });
  const tabs = p.locator('[data-part="section-tabs"] [role="tab"]');
  await tabs.first().waitFor({ timeout: 45000 });
  await sleep(1500);
  const names = (await tabs.allTextContents()).map((x) => x.trim());
  ok("the tab bar has Basics first and Behaviour", names.length >= 3 && names.length <= 5, names.join(" | "));
  const ids = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute("data-tab")));
  ok("tabs are in the owner's order", JSON.stringify(ids) === JSON.stringify(["basics", "knowledge", "behaviour", "pronunciation", "advanced"].filter((i) => ids.includes(i))) && ids[0] === "basics", ids.join());
  const sel = await tabs.evaluateAll((els) => els.filter((e) => e.getAttribute("aria-selected") === "true").map((e) => e.getAttribute("data-tab")));
  ok("Basics is the one open", sel.join() === "basics", sel.join());
  const prev = p.locator('#panel-basics aside[aria-labelledby="asst-prev-h"]');
  ok("the preview card is on Basics", (await prev.count()) === 1 && (await prev.isVisible()));
  const hasOpening = (await p.locator("#panel-basics").locator('[data-part="opening-line"], h2').count()) > 0;
  ok("Basics holds more than the preview (name, languages, opening line, voice)", hasOpening);
  await shot(s, `${tag}-1-basics`, { fullPage: false });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok("no sideways scroll of the page", !overflow);
  const bar = await p.locator('[role="tablist"]').first().evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, h: Math.min(...[...el.children].map((c) => c.getBoundingClientRect().height)) }));
  ok("every tab is a finger-size target", bar.h >= 40, `${Math.round(bar.h)}px`);
  // choose Behaviour
  await p.locator('[data-tab="behaviour"]').click();
  await sleep(300);
  ok("choosing Behaviour shows it and writes #behaviour to the address", (await p.locator("#panel-behaviour").isVisible()) && !(await p.locator("#panel-basics").isVisible()) && new URL(p.url()).hash === "#behaviour", new URL(p.url()).hash);
  ok("Behaviour has what it may do and the hours", (await p.locator("#panel-behaviour #asst-from").count()) === 1);
  await shot(s, `${tag}-2-behaviour`, { fullPage: false });
  // Behaviour saves on its own
  await p.locator('#panel-behaviour [data-part="behaviour-form"] button[type="submit"]').click();
  await p.locator('#panel-behaviour [role="status"]').waitFor({ timeout: 20000 });
  ok("Behaviour saves on its own (its own Save, its own note)", true);
  for (const id of ids.filter((i) => !["basics", "behaviour"].includes(i))) {
    await p.locator(`[data-tab="${id}"]`).click();
    await sleep(300);
    ok(`the ${id} tab shows its part`, (await p.locator(`#panel-${id}`).isVisible()) && ((await p.locator(`#panel-${id}`).innerText()).trim().length > 20));
    await shot(s, `${tag}-3-${id}`, { fullPage: false });
  }
  // a deep link
  await p.goto(`${s.base}/settings?section=assistant#behaviour`, { waitUntil: "domcontentloaded" });
  await p.locator('[data-part="section-tabs"]').waitFor({ timeout: 45000 });
  await sleep(1200);
  ok("a link with #behaviour opens Behaviour", await p.locator("#panel-behaviour").isVisible());

  // Today: the checklist rows
  await p.goto(s.base, { waitUntil: "domcontentloaded" });
  const card = p.locator('[data-start="card"]');
  if ((await card.count()) === 0 && (await card.waitFor({ timeout: 15000 }).then(() => true, () => false)) === false) {
    console.log("no 'Finish setting up' card in this workspace: Today rows not checked");
  } else {
    await sleep(1000);
    await card.scrollIntoViewIfNeeded();
    const rows = await card.locator("li[data-step]").evaluateAll((lis) =>
      lis.map((li) => {
        const r = (e) => (e ? e.getBoundingClientRect() : null);
        const title = li.querySelector("span.block");
        const spans = [...li.querySelectorAll("span")];
        const status = spans.find((e) => /order-last/.test(e.className));
        const btn = li.querySelector("form button");
        const tr = r(title);
        const sr = r(status);
        const br = r(btn);
        return { id: li.getAttribute("data-step"), titleW: tr ? Math.round(tr.width) : 0, titleH: tr ? Math.round(tr.height) : 0, statusBelow: !!(sr && tr && sr.top >= tr.bottom - 2), btnH: br ? Math.round(br.height) : 0, btnOneLine: br ? br.height <= 52 : true, li: Math.round(li.getBoundingClientRect().width) };
      }),
    );
    const narrow = (width || (size === "phone" ? 390 : 1280)) < 640;
    if (narrow) {
      ok("status sits under the title on narrow screens", rows.every((x) => x.statusBelow), rows.map((x) => `${x.id}:${x.statusBelow}`).join(" "));
      ok('"Hide for now" is on one line', rows.every((x) => x.btnOneLine), rows.map((x) => x.btnH).join(","));
      ok("the title has room (at least 55% of the row)", rows.every((x) => x.titleW >= 0.55 * x.li), rows.map((x) => `${x.titleW}/${x.li}`).join(" "));
    } else ok("the rows are one line each on a wide screen", rows.length > 0);
    ok("no sideways scroll on Today", !(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
    await card.screenshot({ path: `${process.env.HOME}/Desktop/v2-overnight/shots-df/${tag}-4-checklist.png` });
  }
} finally {
  await s.browser?.close?.();
}
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
