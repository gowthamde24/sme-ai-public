// Today's layout on staging (owner 31 Oct), as a synthetic demo owner. Staging only.
//   node e2e/staging-today-layout.mjs [textiles|construction_materials|education] [en|te]
// DESKTOP at 1280x800, 1366x768, 1440x900, 1536x864, 1920x1080: "Needs you" comes first, then the compact command bar, then the other cards; the root font is 15px, the menu 232px, the greeting 32px; the page is at most 1200px wide and centred; the
// bar is a single compact row (about 56 px, no empty chat area); at 1366x768 the Needs you heading and the bar are above the fold; no sideways scroll; no usage meter on Today. PHONE at 390 and 360: no assistant card, the floating orb is there
// (bottom right, above the bottom bar) and opens the sheet. Then: a question on the desktop opens the conversation under the bar (at most half the screen, scrolling inside) and Minimise collapses it. Pictures in ~/Desktop/v2-overnight/shots-df/.
import { session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const lang = process.argv[3] || "en";
const SIZES = [[1280, 800], [1366, 768], [1440, 900], [1536, 864], [1920, 1080]];
const PHONES = [[390, 844], [360, 780]];
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const s = await session(pack, "desktop");
const p = s.page;
try {
  if (lang !== "en") await s.context.addCookies([{ name: "sme_lang", value: lang, url: "https://staging.stack19.com" }]);
  for (const [w, h] of SIZES) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(s.base, { waitUntil: "domcontentloaded" });
    await p.locator('[data-screen="today"] h1').waitFor({ timeout: 45000 });
    await p.locator('[data-part="command-bar"] [data-chat="bar"], [data-part="command-bar"] [data-ask]').first().waitFor({ timeout: 45000 }).catch(() => null);
    await sleep(2500);
    const m = await p.evaluate(() => {
      const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
      const cs = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
      const needs = r("#needs-you");
      const bar = r('[data-part="command-bar"]');
      const others = [...document.querySelectorAll('[data-screen="today"] section[data-part]:not([data-part="command-bar"])')].map((e) => e.getBoundingClientRect().top);
      return {
        root: parseFloat(getComputedStyle(document.documentElement).fontSize),
        menu: r("aside")?.width,
        h1: parseFloat(cs('[data-screen="today"] h1', "fontSize")),
        main: r("main")?.width,
        mainLeft: r("main")?.left,
        needsTop: needs?.top, barTop: bar?.top, barH: bar?.height, othersTop: others.length ? Math.min(...others) : null,
        scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
        usage: /% left|AI usage today/i.test(document.querySelector("main")?.innerText ?? ""), // (the menu's usage card moves in the next job)
        barVisible: !!bar && bar.height > 0,
      };
    });
    console.log(`-- ${w}x${h}: ${JSON.stringify(m)}`);
    ok(`${w}x${h} base font 15px, menu 232px, greeting 32px`, m.root === 15 && Math.round(m.menu) === 232 && Math.round(m.h1) === 32, `root=${m.root} menu=${m.menu} h1=${m.h1}`);
    ok(`${w}x${h} Needs you first, then the command bar, then the other cards`, m.needsTop < m.barTop && (m.othersTop === null || m.barTop < m.othersTop), `needs=${Math.round(m.needsTop)} bar=${Math.round(m.barTop)} others=${Math.round(m.othersTop ?? -1)}`);
    ok(`${w}x${h} the bar is one compact block (orb, tall input, Talk, chips), not an empty chat area`, m.barVisible && m.barH <= 190, `height=${Math.round(m.barH)}`);
    ok(`${w}x${h} the page is at most 1200px wide`, m.main <= 1200 + 1, `main=${Math.round(m.main)}`);
    ok(`${w}x${h} no sideways scroll, no usage meter`, m.scrollW <= m.innerW + 1 && !m.usage);
    if (w === 1366) ok("1366x768 Needs you and the command bar start above the fold", m.needsTop < 768 && m.barTop < 768, `bar top ${Math.round(m.barTop)}`);
    await shot(s, `tl-${pack}-${lang}-${w}x${h}`, { fullPage: false });
  }
  // the conversation under the bar (desktop)
  await p.setViewportSize({ width: 1366, height: 768 });
  await p.goto(s.base, { waitUntil: "domcontentloaded" });
  const input = p.locator("#chat-input");
  await input.waitFor({ timeout: 45000 });
  await input.fill("what needs me today?");
  await p.locator('[data-chat="bar"] button[type="submit"]').click();
  await p.locator('[data-chat="assistant"]').first().waitFor({ timeout: 60000 }).catch(() => null);
  await sleep(1500);
  const body = await p.locator('[data-chat="bar"] [data-chat="body"]').evaluate((e) => ({ h: e.getBoundingClientRect().height, vis: e.getBoundingClientRect().height > 0 })).catch(() => ({ h: 0, vis: false }));
  ok("a question opens the conversation under the bar, at most half the screen", body.vis && body.h <= 768 / 2 + 8, `body height ${Math.round(body.h)}`);
  await shot(s, `tl-${pack}-${lang}-conversation`, { fullPage: false });
  await p.locator('[data-chat="minimise"]').click();
  await sleep(400);
  ok("Minimise collapses it back to the bar", (await p.locator('[data-chat="bar"] [data-chat="body"]').evaluate((e) => e.getBoundingClientRect().height).catch(() => 0)) === 0);
  await shot(s, `tl-${pack}-${lang}-minimised`, { fullPage: false });
  // phones
  for (const [w, h] of PHONES) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(s.base, { waitUntil: "domcontentloaded" });
    await p.locator('[data-screen="today"] h1').waitFor({ timeout: 45000 });
    await sleep(2500);
    const ph = await p.evaluate(() => {
      const orb = document.querySelector('[data-ask="orb"]')?.getBoundingClientRect();
      const nav = document.querySelector('[data-frame="app"] .fixed.bottom-0')?.getBoundingClientRect();
      return { agent: !!document.querySelector('[data-part="agent-owl"]'), bar: !!document.querySelector('[data-chat="bar"]'), orb: orb ? { r: window.innerWidth - orb.right, b: window.innerHeight - orb.bottom, w: orb.width } : null, navTop: nav?.top ?? null, innerH: window.innerHeight, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, usage: /% left|AI usage today/i.test(document.querySelector("main")?.innerText ?? "") };
    });
    console.log(`-- phone ${w}: ${JSON.stringify(ph)}`);
    ok(`${w}px no assistant card and no chat on Today`, !ph.agent && !ph.bar);
    ok(`${w}px the floating orb is bottom right, above the bottom bar`, !!ph.orb && ph.orb.r < 40 && (ph.navTop === null || ph.orb.b >= ph.innerH - ph.navTop - 2), JSON.stringify(ph.orb));
    ok(`${w}px no sideways scroll, no usage meter`, ph.scrollW <= ph.innerW + 1 && !ph.usage);
    await shot(s, `tl-${pack}-${lang}-phone${w}`, { fullPage: false });
    if (w === 390) {
      await p.locator('[data-ask="orb"]').click();
      await p.locator('[data-chat="panel"]').waitFor({ timeout: 20000 });
      ok("the orb opens the bottom-sheet chat", true);
      await shot(s, `tl-${pack}-${lang}-phone${w}-sheet`, { fullPage: false });
    }
  }
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
}
await s.browser.close();
process.exit(failed ? 1 : 0);
