// The assistant row of Today, "composer + orb-as-Talk" (owner 31 Oct), on staging as a synthetic demo owner. Staging only.
//   node e2e/staging-bar-c.mjs [textiles|construction_materials|education] [en|te]
// Desktop (1366x768, 1440x900, 1920x1080), after "Needs you": on the LEFT the animated orb (about 64px, a soft ring, "Tap to talk"): the orb IS the Live/Talk button (no separate Talk pill); on the RIGHT a rounded composer card: the text on top, the toolbar under it
// (plus, language pill, spacer, mic, send); the chips under the composer. A conversation opens directly under the composer with its own header and Minimise. The pill offers Auto, Telugu, English, Hindi, Kannada, Tamil, Malayalam, is remembered after a reload.
// Phone (390): no card on Today, the floating orb opens the sheet with the same composer and the orb at its top as Talk. Pictures in ~/Desktop/v2-overnight/shots-df/.
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
      const mid = (e) => { const b = e.getBoundingClientRect(); return (b.top + b.bottom) / 2; };
      const bar = document.querySelector('[data-chat="bar"]');
      const form = bar.querySelector('[data-chat="form"]');
      const f = form.getBoundingClientRect();
      const tb = form.querySelector('[data-chat="toolbar"]');
      const items = [...tb.querySelectorAll('[data-chat="plus"], [data-chat="language"], [data-chat="dictate"], button[type="submit"]')];
      const tbMid = mid(tb);
      const talk = bar.querySelector('[data-chat="live-talk"]');
      const orb = talk.querySelector("[data-orb]").getBoundingClientRect();
      const chips = bar.querySelector('[data-chat="chips"] li')?.getBoundingClientRect();
      return {
        orb: Math.round(orb.width), talkRight: talk.getBoundingClientRect().right, formLeft: f.left, formRadius: getComputedStyle(form).borderTopLeftRadius, formH: Math.round(f.height),
        textAbove: form.querySelector("textarea").getBoundingClientRect().bottom <= tb.getBoundingClientRect().top + 2,
        off: items.filter((e) => Math.abs(mid(e) - tbMid) > 2).map((e) => e.getAttribute("data-chat") ?? "send"),
        talkText: talk.innerText.trim(), caption: bar.querySelector('[data-chat="talk-caption"]')?.innerText.trim(), ring: !!talk.querySelector('[data-chat="ring"]'),
        chipsTop: chips?.top ?? null, formBottom: f.bottom, needsTop: document.querySelector("#needs-you")?.getBoundingClientRect().top, barTop: bar.getBoundingClientRect().top,
        orbCount: document.querySelectorAll("[data-screen='today'] [data-orb]").length, scrollW: document.documentElement.scrollWidth, innerW: innerWidth, outerBorder: getComputedStyle(bar).borderTopWidth,
      };
    });
    console.log(`-- ${w}x${h}: ${JSON.stringify(m)}`);
    ok(`${w}x${h} the orb is about 64px, on the left, with a soft ring and a caption`, m.orb >= 60 && m.orb <= 68 && m.ring && !!m.caption && m.talkRight <= m.formLeft + 1, `orb=${m.orb} caption=${m.caption}`);
    ok(`${w}x${h} the orb IS the Talk button (no separate Talk pill)`, m.talkText === "", `button text="${m.talkText}"`);
    ok(`${w}x${h} the composer is a rounded 16px card, the text on top, the toolbar under it`, m.formRadius === "16px" && m.textAbove, `radius=${m.formRadius}`);
    ok(`${w}x${h} the toolbar items (plus, pill, mic, send) are vertically centred`, m.off.length === 0, m.off.join(","));
    ok(`${w}x${h} the chips are under the composer`, m.chipsTop === null || m.chipsTop >= m.formBottom - 1);
    ok(`${w}x${h} after Needs you; one orb on the page; no card around the row; no sideways scroll`, m.needsTop < m.barTop && m.orbCount === 1 && m.outerBorder === "0px" && m.scrollW <= m.innerW + 1, `orbs=${m.orbCount}`);
    await shot(s, `bc-${pack}-${lang}-${w}x${h}`, { fullPage: false });
  }
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
  await p.locator("#chat-input").fill("what needs me today?");
  await p.locator('[data-chat="bar"] button[type="submit"]').click();
  await p.locator('[data-chat="assistant"]').first().waitFor({ timeout: 60000 }).catch(() => null);
  await sleep(1500);
  const head = await p.locator('[data-chat="bar"] [data-chat="speaking-in"]').evaluate((e) => e.parentElement.innerText.replace(/\s+/g, " ")).catch(() => "");
  ok("the conversation opens under the composer with 'Your assistant · speaking in <language>' and Minimise", head.includes("·") && (await p.locator('[data-chat="minimise"]').count()) === 1, head);
  const bh = await p.locator('[data-chat="bar"] [data-chat="body"]').evaluate((e) => e.getBoundingClientRect().height).catch(() => 0);
  ok("…at most half the screen, scrolling inside", bh > 0 && bh <= 768 / 2 + 8, `body=${Math.round(bh)}`);
  await shot(s, `bc-${pack}-${lang}-conversation`, { fullPage: false });
  await p.locator('[data-chat="minimise"]').click();
  await sleep(300);
  ok("Minimise collapses it", (await p.locator('[data-chat="bar"] [data-chat="body"]').evaluate((e) => e.getBoundingClientRect().height)) === 0);
  await p.locator('[data-chat="plus"]').click();
  ok("the plus menu has a new conversation and the history", (await p.locator('[data-chat="plus-menu"] [role="menuitem"]').count()) === 2);
  await sel.selectOption(start);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(s.base, { waitUntil: "domcontentloaded" });
  await p.locator('[data-ask="orb"]').waitFor({ timeout: 45000 });
  const orb = await p.locator('[data-ask="orb"]').evaluate((e) => Math.round(e.getBoundingClientRect().width));
  ok("phone: no card on Today, the floating orb is at least 56px", orb >= 56 && (await p.locator('[data-chat="bar"]').count()) === 0, `orb=${orb}`);
  await shot(s, `bc-${pack}-${lang}-phone390`, { fullPage: false });
  await p.locator('[data-ask="orb"]').click();
  await p.locator('[data-chat="panel"]').waitFor({ timeout: 20000 });
  const kinds = await p.locator('[data-chat="panel"] [data-chat="toolbar"] select, [data-chat="panel"] [data-chat="toolbar"] button').evaluateAll((els) => els.map((e) => (e.tagName === "SELECT" ? "pill" : e.getAttribute("data-chat") || e.getAttribute("type"))));
  const orbAbove = await p.evaluate(() => {
    const t = document.querySelector('[data-chat="panel"] [data-chat="live-talk"]').getBoundingClientRect();
    const f = document.querySelector('[data-chat="panel"] [data-chat="form"]').getBoundingClientRect();
    return t.bottom <= f.top;
  });
  ok("phone sheet: the same composer (plus, pill, mic, send) with the orb at its top as Talk", kinds.join() === "plus,pill,dictate,submit" && orbAbove, kinds.join());
  await shot(s, `bc-${pack}-${lang}-phone390-sheet`, { fullPage: false });
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
}
await s.browser.close();
process.exit(failed ? 1 : 0);
