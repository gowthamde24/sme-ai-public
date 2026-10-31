// The assistant bar, design C (owner 31 Oct), on staging as a synthetic demo owner. Staging only.
//   node e2e/staging-bar-c.mjs [textiles|construction_materials|education] [en|te]
// Desktop (1366x768, 1440x900, 1920x1080): after "Needs you": the wave orb about 64px on the left, a tall rounded input bar (about 56px) with the plus, the text, the language pill, Dictate and Send, the prominent clay "Talk" button on the right, the chips under the
// bar, no empty chat area; the pill offers Auto, Telugu, English, Hindi, Kannada, Tamil, Malayalam, starts as the app's language, and the choice is remembered after a reload. A question opens the conversation below (at most half the screen) with Minimise.
// Phone (390): no card on Today, the floating orb (56px or more) opens the sheet with the same pieces (pill, Dictate, Talk, Send). Pictures in ~/Desktop/v2-overnight/shots-df/.
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
const OPTIONS = ["Auto", "తెలుగు", "English", "हिंदी", "ಕನ್ನಡ", "தமிழ்", "മലയാളം"];
try {
  if (lang !== "en") await s.context.addCookies([{ name: "sme_lang", value: lang, url: "https://staging.stack19.com" }]);
  for (const [w, h] of [[1366, 768], [1440, 900], [1920, 1080]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(s.base, { waitUntil: "domcontentloaded" });
    await p.locator('[data-chat="bar"] [data-chat="form"]').waitFor({ timeout: 45000 });
    await sleep(2500);
    const m = await p.evaluate(() => {
      const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
      const bar = r('[data-chat="bar-row"]'), form = r('[data-chat="bar"] [data-chat="form"]'), talk = r('[data-chat="bar"] [data-chat="live-talk"]'), orb = r('[data-chat="bar-row"] [data-orb]'), needs = r("#needs-you"), chips = r('[data-chat="bar"] [data-chat="chips"]');
      const talkStyle = getComputedStyle(document.querySelector('[data-chat="bar"] [data-chat="live-talk"]'));
      return { orb: orb && Math.round(orb.width), formH: form && Math.round(form.height), talkLeft: talk && Math.round(talk.left), formRight: form && Math.round(form.right), talkBg: talkStyle.backgroundColor, needsTop: needs?.top, barTop: bar?.top, chipsTop: chips?.top, barBottom: bar?.bottom, scrollW: document.documentElement.scrollWidth, innerW: innerWidth, pill: document.querySelector('[data-chat="bar"] [data-chat="language"]')?.textContent?.trim() };
    });
    console.log(`-- ${w}x${h}: ${JSON.stringify(m)}`);
    ok(`${w}x${h} the orb is about 64px`, m.orb >= 60 && m.orb <= 68, `orb=${m.orb}`);
    ok(`${w}x${h} the input bar is tall (about 56px)`, m.formH >= 52 && m.formH <= 64, `form=${m.formH}`);
    ok(`${w}x${h} Talk is a separate prominent button on the right, clay fill`, m.talkLeft >= m.formRight && !/rgba?\(0, 0, 0, 0\)|transparent/.test(m.talkBg), `talkBg=${m.talkBg}`);
    const c = await p.evaluate(() => {
      const row = document.querySelector('[data-chat="bar"] [data-chat="form"]');
      const f = row.getBoundingClientRect();
      const mid = (e) => { const b = e.getBoundingClientRect(); return (b.top + b.bottom) / 2; };
      const parts = [...row.querySelectorAll('[data-chat="plus"], textarea, [data-chat="language"], [data-chat="dictate"], button[type="submit"]')].map((e) => ({ name: e.getAttribute("data-chat") ?? e.tagName.toLowerCase(), d: Math.abs(mid(e) - (f.top + f.bottom) / 2) }));
      const outer = document.querySelector('[data-chat="bar"]');
      const cs = getComputedStyle(outer);
      const orbs = document.querySelectorAll("main [data-orb], [data-screen='today'] [data-orb]").length;
      const chips = document.querySelector('[data-chat="bar"] [data-chat="chips"]')?.getBoundingClientRect();
      return { off: parts.filter((x) => x.d > 2).map((x) => `${x.name}:${x.d.toFixed(1)}`), outerBorder: cs.borderTopWidth, outerBg: cs.backgroundColor, orbs, chipsLeft: chips ? chips.left : null, formLeft: f.left };
    });
    ok(`${w}x${h} everything inside the input is vertically centred`, c.off.length === 0, c.off.join(","));
    ok(`${w}x${h} no outer card around the bar`, c.outerBorder === "0px" && /rgba?\(0, 0, 0, 0\)|transparent/.test(c.outerBg), `border=${c.outerBorder} bg=${c.outerBg}`);
    ok(`${w}x${h} one orb on the page; the chips start at the input's left edge`, c.orbs === 1 && (c.chipsLeft === null || Math.abs(c.chipsLeft - c.formLeft) <= 2), `orbs=${c.orbs} chips=${c.chipsLeft} input=${c.formLeft}`);
    ok(`${w}x${h} after Needs you, chips under the bar, no sideways scroll`, m.needsTop < m.barTop && (m.chipsTop === undefined || m.chipsTop >= m.barBottom - 2) && m.scrollW <= m.innerW + 1);
    await shot(s, `bc-${pack}-${lang}-${w}x${h}`, { fullPage: false });
  }
  // the pill
  await p.setViewportSize({ width: 1366, height: 768 });
  await p.goto(s.base, { waitUntil: "domcontentloaded" });
  const sel = p.locator('[data-chat="bar"] [data-chat="language"] select');
  await sel.waitFor({ timeout: 45000 });
  const opts = await sel.locator("option").allTextContents();
  ok("the pill offers Auto, Telugu, English, Hindi, Kannada, Tamil, Malayalam", opts.length === 7 && opts.slice(1).join() === OPTIONS.slice(1).join(), opts.join(" | "));
  const start = await sel.inputValue();
  ok("it starts as the app's language (or what the person saved before: the profile's choice wins)", [lang === "te" ? "te" : "en", "auto"].includes(start), `value=${start}`);
  await sel.selectOption("te");
  await p.reload({ waitUntil: "domcontentloaded" });
  await sel.waitFor({ timeout: 45000 });
  ok("the choice is remembered after a reload", (await sel.inputValue()) === "te");
  await shot(s, `bc-${pack}-${lang}-pill-te`, { fullPage: false });
  await sel.selectOption(start); // back to the default for the next run
  // a question opens the conversation below; Minimise
  await p.locator("#chat-input").fill("what needs me today?");
  await p.locator('[data-chat="bar"] button[type="submit"]').click();
  await p.locator('[data-chat="assistant"]').first().waitFor({ timeout: 60000 }).catch(() => null);
  await sleep(1500);
  const bh = await p.locator('[data-chat="bar"] [data-chat="body"]').evaluate((e) => e.getBoundingClientRect().height).catch(() => 0);
  ok("the conversation opens below the bar, at most half the screen", bh > 0 && bh <= 768 / 2 + 8, `body=${Math.round(bh)}`);
  await shot(s, `bc-${pack}-${lang}-conversation`, { fullPage: false });
  await p.locator('[data-chat="minimise"]').click();
  await sleep(300);
  ok("Minimise collapses it", (await p.locator('[data-chat="bar"] [data-chat="body"]').evaluate((e) => e.getBoundingClientRect().height)) === 0);
  // the plus menu
  await p.locator('[data-chat="plus"]').click();
  ok("the plus menu has a new conversation and the history", (await p.locator('[data-chat="plus-menu"] [role="menuitem"]').count()) === 2);
  await shot(s, `bc-${pack}-${lang}-plus`, { fullPage: false });
  // phone
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(s.base, { waitUntil: "domcontentloaded" });
  await p.locator('[data-ask="orb"]').waitFor({ timeout: 45000 });
  const orb = await p.locator('[data-ask="orb"]').evaluate((e) => Math.round(e.getBoundingClientRect().width));
  ok("phone: no card on Today, the floating orb is at least 56px", orb >= 56 && (await p.locator('[data-chat="bar"]').count()) === 0, `orb=${orb}`);
  await shot(s, `bc-${pack}-${lang}-phone390`, { fullPage: false });
  await p.locator('[data-ask="orb"]').click();
  await p.locator('[data-chat="panel"]').waitFor({ timeout: 20000 });
  const kinds = await p.locator('[data-chat="panel"] [data-chat="actions"] select, [data-chat="panel"] [data-chat="actions"] button').evaluateAll((els) => els.map((e) => (e.tagName === "SELECT" ? "pill" : e.getAttribute("data-chat") || e.getAttribute("type"))));
  ok("phone sheet: the same bar pieces (pill, mic, Talk, Send)", kinds.join() === "pill,dictate,live-talk,submit", kinds.join());
  await shot(s, `bc-${pack}-${lang}-phone390-sheet`, { fullPage: false });
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
}
await s.browser.close();
process.exit(failed ? 1 : 0);
