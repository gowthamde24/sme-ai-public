// The owner's review of Today (1 Nov), on staging as a synthetic demo owner. Staging only.
//   node e2e/staging-review-fixes.mjs [textiles|construction_materials|education] [en|te]
// 1 order: greeting, slim example line, Needs you, composer and orb, the cards, Finish setting up (one row at 5+ done).  2 Start demo is a small pill in the header (desktop and phone), nothing floats but the phone orb.
// 3 phone: the floating orb covers no button at the end of the page.  4 Needs you rows: short badge, "Name asked for a call · price and visit", Approve / Store visit; in Telugu every part is Telugu except names.
// 5 made-up people, no "Demo owner" / "Demo lead".  6 the orb is solid accent with a waveform.  7 the workspace name wraps to two lines before it is cut.
import { session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
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
  for (const theme of ["light", "dark"]) {
    await s.context.addCookies([{ name: "sme_theme", value: theme, url: "https://staging.stack19.com" }]);
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(s.base, { waitUntil: "domcontentloaded" });
    await p.locator('[data-part="command-bar"] [data-chat="form"]').waitFor({ timeout: 45000 });
    await sleep(2500);
    const m = await p.evaluate(() => {
      const top = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? null;
      const h1 = document.querySelector('[data-screen="today"] h1');
      const header = document.querySelector("header[class*='sticky']");
      const orb = document.querySelector('[data-chat="live-talk"] [data-orb]');
      const ex = document.querySelector("[data-example]");
      const setup = document.querySelector('[data-start="card"]');
      const cs = orb ? getComputedStyle(orb) : null;
      const name = document.querySelector("aside span.line-clamp-2");
      return {
        h1: h1?.innerText.replace(/\n/g, " "),
        tops: { h1: top('[data-screen="today"] h1'), example: ex ? ex.getBoundingClientRect().top : null, needs: top("#needs-you"), bar: top('[data-part="command-bar"]'), store: top('[data-part="visits"]'), team: top('[data-part="team"]'), setup: setup ? setup.getBoundingClientRect().top : null },
        exampleIsCard: ex ? getComputedStyle(ex).borderTopWidth !== "0px" : null,
        exampleHeight: ex ? Math.round(ex.getBoundingClientRect().height) : null,
        setupCollapsed: setup?.getAttribute("data-collapsed") ?? null,
        setupHeight: setup ? Math.round(setup.getBoundingClientRect().height) : null,
        demoPill: (() => { const b = document.querySelector('[data-part="guided-demo-start"]'); return b ? { inHeader: !!header?.contains(b), position: getComputedStyle(b).position, h: Math.round(b.getBoundingClientRect().height) } : null; })(),
        fixedOverContent: [...document.querySelectorAll("body *")].filter((e) => getComputedStyle(e).position === "fixed" && e.getBoundingClientRect().width > 0 && !e.closest("aside") && !e.matches("header, header *") && !e.closest('[data-frame="install"]') && e.getBoundingClientRect().height > 0).map((e) => e.getAttribute("data-part") ?? e.getAttribute("data-ask") ?? e.tagName).slice(0, 6),
        orbBg: cs?.backgroundColor, orbSvg: !!orb?.querySelector("svg"), orbCanvas: !!document.querySelector('[data-chat="live-talk"] canvas'),
        nameLines: name ? Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)) : null,
        needsRows: [...document.querySelectorAll("[data-needs-row]")].map((r) => ({ text: r.innerText.replace(/\s+/g, " "), badge: r.querySelector("span")?.innerText, buttons: [...r.querySelectorAll("button:not(.sr-only)")].map((b) => b.innerText) })),
        body: document.body.innerText,
      };
    });
    console.log(`-- ${theme}: ${JSON.stringify({ ...m, body: undefined, needsRows: undefined })}`);
    console.log(`   rows: ${JSON.stringify(m.needsRows)}`);
    const t = m.tops;
    ok(`${theme} order: greeting, example line, Needs you, composer/orb, cards, then Finish setting up`, t.h1 < (t.example ?? t.needs) && (t.example === null || t.example < t.needs) && t.needs < t.bar && t.bar < (t.store ?? t.team) && (t.setup === null || t.setup > (t.team ?? t.store)), JSON.stringify(t));
    ok(`${theme} the example notice is ONE slim line, not a card`, m.exampleIsCard === null || (m.exampleIsCard === false && m.exampleHeight <= 60), `card=${m.exampleIsCard} h=${m.exampleHeight}`);
    ok(`${theme} Finish setting up is one row when 5+ are done (else the list)`, m.setupCollapsed === null || m.setupHeight <= 72, `collapsed=${m.setupCollapsed} h=${m.setupHeight}`);
    ok(`${theme} Start demo is a pill in the header, not floating`, m.demoPill === null || (m.demoPill.inHeader && m.demoPill.position !== "fixed" && m.demoPill.h <= 40), JSON.stringify(m.demoPill));
    ok(`${theme} nothing floats over the desktop page`, m.fixedOverContent.length === 0, m.fixedOverContent.join(","));
    ok(`${theme} the orb is solid accent with a waveform (no swirl)`, !/rgba?\(0, 0, 0, 0\)/.test(m.orbBg ?? "") && m.orbSvg && !m.orbCanvas, m.orbBg);
    ok(`${theme} the workspace name may use two lines`, m.nameLines === null || m.nameLines <= 2, `lines=${m.nameLines}`);
    ok(`${theme} no "Demo owner" / "Demo lead" on the page`, !/Demo owner|Demo lead/.test(m.body));
    if (m.needsRows.length) {
      const r = m.needsRows[0];
      ok(`${theme} Needs you row: short badge and short buttons`, !/needs your OK/.test(r.text) && r.badge.length <= 14 && r.buttons.every((b) => b.length <= 14), JSON.stringify(r));
      if (lang === "te") ok(`${theme} every word of the row is Telugu except the name`, !/\b[A-Za-z]{4,}\b/.test(r.text.replace(/^[A-Za-z]+(\s[A-Za-z]+)?/, "").replace(/\b(Ramesh|Sunitha|Venkat|Lakshmi|Ravi|Anitha|Babu|Rao|Reddy|Naidu|Goud|Kumari|Kumar|Latha|Teja|Chowdary|Padmaja|Srinivas|Kiran|Madhavi|Swathi|Prasad)\b/g, "")), r.text);
    }
    await shot(s, `rv-${pack}-${lang}-${theme}-1440`, { fullPage: true });
  }
  // phone
  await p.setViewportSize({ width: 390, height: 844 });
  await s.context.addCookies([{ name: "sme_theme", value: "light", url: "https://staging.stack19.com" }]);
  await p.goto(s.base, { waitUntil: "domcontentloaded" });
  await p.locator('[data-ask="orb"]').waitFor({ timeout: 45000 });
  await sleep(2000);
  const ph = await p.evaluate(() => {
    const header = document.querySelector("header[class*='sticky']");
    const b = document.querySelector('[data-part="guided-demo-start"]');
    return { pill: b ? { inHeader: !!header?.contains(b), fixed: getComputedStyle(b).position === "fixed", right: Math.round(b.getBoundingClientRect().right), left: Math.round(b.getBoundingClientRect().left) } : null, scrollW: document.documentElement.scrollWidth, innerW: innerWidth, headerH: Math.round(header.getBoundingClientRect().height) };
  });
  ok("phone: Start demo is a small pill in the header, no sideways scroll", ph.pill === null || (ph.pill.inHeader && !ph.pill.fixed && ph.scrollW <= ph.innerW + 1), JSON.stringify(ph));
  await shot(s, `rv-${pack}-${lang}-light-390`, { fullPage: false });
  // the end of the page: the orb must cover no button or link
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(800);
  const cover = await p.evaluate(() => {
    const o = document.querySelector('[data-ask="orb"]').getBoundingClientRect();
    const hit = [...document.querySelectorAll("a, button, summary, input, select, textarea")].filter((e) => !e.closest('[data-ask="orb"]') && getComputedStyle(e).visibility !== "hidden").map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && r.height > 0 && r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top);
    const tab = document.querySelector('[data-frame="tabbar"], nav[aria-label]:last-of-type')?.getBoundingClientRect();
    return { covered: hit.map(({ e }) => (e.innerText || e.getAttribute("aria-label") || e.tagName).slice(0, 24)), orbBottom: Math.round(o.bottom), tabTop: tab ? Math.round(tab.top) : null, orbSize: Math.round(o.width) };
  });
  ok("phone: at the end of the page the floating orb covers no button or link, and sits above the tab bar", cover.covered.length === 0 && (cover.tabTop === null || cover.orbBottom <= cover.tabTop), JSON.stringify(cover));
  await shot(s, `rv-${pack}-${lang}-light-390-end`, { fullPage: false });
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 220));
}
await s.browser.close();
process.exit(failed ? 1 : 0);
