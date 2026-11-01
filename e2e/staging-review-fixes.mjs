// The owner's review of Today (1 Nov), on staging as a synthetic demo owner. Staging only.
//   node e2e/staging-review-fixes.mjs [textiles|construction_materials|education] [en|te]
// 1 order: greeting, slim example line, Needs you, composer and orb, the cards, Finish setting up (one row at 5+ done).  2 Start demo is a small pill in the header (desktop and phone), nothing floats but the phone orb.
// 3 phone: the floating orb covers no button at the end of the page.  4 Needs you rows: short badge, "Name asked for a call · price and visit", Approve / Store visit; in Telugu every part is Telugu except names.
// Polish (1 Nov, later): the greeting-row pill says what the assistant does ("Watching for leads", "Calling Ramesh", never "All caught up"); the cards leave no hole (an odd last card is one full-width row); the phone Needs you is compact rows like the desktop, no explainer;
// the phone orb covers no button at the end of the page at 390 and 360; no "machine-written / not reviewed" notice anywhere (te and kn).
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
    const poll = await p.evaluate(() => {
      const pill = document.querySelector('[data-live="pill"]');
      const grid = document.querySelector('[data-part="visits"], [data-part="team"]')?.parentElement;
      const kids = grid ? [...grid.children].filter((e) => e.getBoundingClientRect().height > 0) : [];
      const last = kids[kids.length - 1]?.getBoundingClientRect();
      const g = grid?.getBoundingClientRect();
      return { pill: pill?.textContent?.replace(/\s+/g, " ").trim(), needs: Number(document.querySelector("[data-count]")?.getAttribute("data-count") ?? 0), kids: kids.length, lastW: last ? Math.round(last.width) : null, gridW: g ? Math.round(g.width) : null, lastH: last ? Math.round(last.height) : null, notice: /machine|యంత్రం రాసిన|ಯಂತ್ರ ಬರೆದ|मशीन से लिखा|translation notice/i.test(document.body.innerText) || !!document.querySelector('[aria-label*="ranslation notice"], [title*="achine"]') };
    });
    console.log(`   pill/cards: ${JSON.stringify(poll)}`);
    ok(`${theme} the pill says what the assistant does, never "All caught up"`, !poll.pill || (!/All caught up|అన్నీ పూర్తయ్యాయి/.test(poll.pill)), poll.pill);
    ok(`${theme} the cards leave no hole (an odd last card is one full-width compact row)`, poll.kids % 2 === 0 || (poll.lastW >= poll.gridW - 2 && poll.lastH <= 100), JSON.stringify({ kids: poll.kids, lastW: poll.lastW, gridW: poll.gridW, lastH: poll.lastH }));
    ok(`${theme} no "machine-written / not reviewed" notice anywhere on the page`, !poll.notice);
    if (m.needsRows.length) {
      const r = m.needsRows[0];
      ok(`${theme} Needs you row: short badge and short buttons`, !/needs your OK/.test(r.text) && r.badge.length <= 14 && r.buttons.every((b) => b.length <= 14), JSON.stringify(r));
      if (lang === "te") ok(`${theme} every word of the row is Telugu except the name`, !/\b[A-Za-z]{4,}\b/.test(r.text.replace(/^[A-Za-z]+(\s[A-Za-z]+)?/, "").replace(/\b(Ramesh|Sunitha|Venkat|Lakshmi|Ravi|Anitha|Babu|Rao|Reddy|Naidu|Goud|Kumari|Kumar|Latha|Teja|Chowdary|Padmaja|Srinivas|Kiran|Madhavi|Swathi|Prasad)\b/g, "")), r.text);
    }
    await shot(s, `rv-${pack}-${lang}-${theme}-1440`, { fullPage: true });
  }
  if (lang !== "en") {
    // no "machine-written / not reviewed" line on the other screens either: Settings, and the public site and legal page in this language
    const NOTICE = /machine-written|machine written|not yet (read|checked|reviewed)|యంత్రం రాసిన|ಯಂತ್ರ ಬರೆದ|मशीन से लिखा/i;
    for (const [name, url] of [["Settings", `${s.base}/settings`], ["public site", `https://staging.stack19.com/${lang}`], ["legal page", `https://staging.stack19.com/terms`]]) {
      await p.goto(url, { waitUntil: "domcontentloaded" });
      await sleep(2500);
      ok(`${name} in ${lang}: no machine-translation notice`, !NOTICE.test(await p.evaluate(() => document.body.innerText)) && (await p.locator('[aria-label*="ranslation notice"], [title*="achine"]').count()) === 0);
    }
  }
  // phone, at 390 and 360
  for (const w of [390, 360]) {
    await p.setViewportSize({ width: w, height: w === 390 ? 844 : 740 });
    await s.context.addCookies([{ name: "sme_theme", value: "light", url: "https://staging.stack19.com" }]);
    await p.goto(s.base, { waitUntil: "domcontentloaded" });
    await p.locator('[data-ask="orb"]').waitFor({ timeout: 45000 });
    await sleep(2500);
    const ph = await p.evaluate(() => {
      const header = document.querySelector("header[class*='sticky']");
      const b = document.querySelector('[data-part="guided-demo-start"]');
      const rows = [...document.querySelectorAll("[data-needs-row]")];
      return {
        pill: b ? { inHeader: !!header?.contains(b), fixed: getComputedStyle(b).position === "fixed" } : null, scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
        headerOverflow: [...header.querySelectorAll("button, a, select")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length,
        rows: rows.length, rowH: rows.map((r) => Math.round(r.getBoundingClientRect().height)), rowText: rows.map((r) => r.innerText.replace(/\s+/g, " ")), explainer: /always wait for you/.test(document.body.innerText), needsOk: /needs your OK/.test(document.body.innerText),
        cards: document.querySelectorAll('[data-part="needs-card"], article[aria-labelledby^="needs-"]').length,
      };
    });
    console.log(`   phone ${w}: ${JSON.stringify({ ...ph, rowText: undefined })}`);
    ok(`phone ${w}: Start demo is a small pill in the header, everything fits, no sideways scroll`, (ph.pill === null || (ph.pill.inHeader && !ph.pill.fixed)) && ph.scrollW <= ph.innerW + 1 && ph.headerOverflow === 0, JSON.stringify({ pill: ph.pill, scrollW: ph.scrollW, over: ph.headerOverflow }));
    ok(`phone ${w}: Needs you is compact rows (at most 3), no "needs your OK", no explainer paragraph`, ph.rows <= 3 && ph.cards === 0 && ph.rowH.every((h) => h <= 150) && !ph.needsOk && !ph.explainer, JSON.stringify({ rows: ph.rows, rowH: ph.rowH, explainer: ph.explainer, needsOk: ph.needsOk }));
    if (ph.rows && lang === "en") ok(`phone ${w}: a row reads "Name asked for a call · price and visit" with Approve and Store visit`, /asked for a call · price and visit/.test(ph.rowText[0]) && /Approve/.test(ph.rowText[0]) && /Store visit/.test(ph.rowText[0]), ph.rowText[0]);
    await shot(s, `rv-${pack}-${lang}-light-${w}`, { fullPage: false });
    // the end of the page: the orb must cover no button or link, and sits above the tab bar
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(900);
    const cover = await p.evaluate(() => {
      const o = document.querySelector('[data-ask="orb"]').getBoundingClientRect();
      const hit = [...document.querySelectorAll("a, button, summary, input, select, textarea")].filter((e) => !e.closest('[data-ask="orb"]') && getComputedStyle(e).visibility !== "hidden").map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && r.height > 0 && r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top);
      const bars = [...document.querySelectorAll("nav, div")].filter((e) => getComputedStyle(e).position === "fixed" && e.getAttribute("data-ask") !== "orb" && Math.abs(e.getBoundingClientRect().bottom - innerHeight) < 2 && e.getBoundingClientRect().width > innerWidth * 0.9 && e.getBoundingClientRect().height > 40);
      const tab = bars.length ? Math.min(...bars.map((e) => e.getBoundingClientRect().top)) : null;
      return { covered: hit.map(({ e }) => (e.innerText || e.getAttribute("aria-label") || e.tagName).slice(0, 24)), orbBottom: Math.round(o.bottom), orbRight: Math.round(innerWidth - o.right), tabTop: tab === null ? null : Math.round(tab), orbSize: Math.round(o.width) };
    });
    ok(`phone ${w}: at the end of the page the floating orb covers no button or link, and sits above the tab bar`, cover.covered.length === 0 && (cover.tabTop === null || cover.orbBottom <= cover.tabTop), JSON.stringify(cover));
    await shot(s, `rv-${pack}-${lang}-light-${w}-end`, { fullPage: false });
  }
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 220));
}
await s.browser.close();
process.exit(failed ? 1 : 0);
