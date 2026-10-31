// The orb's chat panel with the design-C bar (owner 31 Oct), on staging as a synthetic demo owner. Staging only.
//   node e2e/staging-panel-c.mjs [textiles|construction_materials|education] [en|te]
// Desktop 1366x768 (and 1280/1920): the panel opened from the floating orb on a screen other than Today. EMPTY it fits its content (the greeting, the chips directly under it, the input, Talk): no big blank area. With a conversation it grows up to about 560 px,
// then the thread scrolls inside. One rounded input row (plus, text, language pill, mic, send), Talk as its own pill below, chips ABOVE the input; nothing overlaps at any width (every control inside the row, no two overlapping, Talk below the row's border).
// Phone 390: the same bar in the bottom sheet. Pictures in ~/Desktop/v2-overnight/shots-df/.
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
const geometry = () =>
  p.evaluate(() => {
    const r = (el) => { const b = el?.getBoundingClientRect(); return b ? { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } : null; };
    const panel = document.querySelector('[data-chat="panel"]');
    const form = panel.querySelector('[data-chat="form"]');
    const talk = panel.querySelector('[data-chat="live-talk"]');
    const parts = [...form.querySelectorAll('[data-chat="plus"], textarea, [data-chat="language"], [data-chat="dictate"], button[type="submit"], button[type="button"][data-chat="stop"]')].map((e) => ({ name: e.getAttribute("data-chat") ?? e.tagName.toLowerCase(), ...r(e) }));
    const overlaps = [];
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) { const a = parts[i], b = parts[j]; if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) overlaps.push(`${a.name}/${b.name}`); }
    const f = r(form);
    const outside = parts.filter((a) => a.l < f.l - 0.5 || a.r > f.r + 0.5 || a.t < f.t - 0.5 || a.b > f.b + 0.5).map((a) => a.name);
    const body = panel.querySelector('[data-chat="body"]');
    const chips = panel.querySelector('[data-chat="chips"]');
    return { panel: r(panel), form: f, talk: r(talk), body: r(body), chips: chips ? r(chips) : null, overlaps, outside, talkBelow: r(talk).t >= f.b - 0.5, vw: innerWidth, vh: innerHeight, bodyScrolls: body.scrollHeight > body.clientHeight + 1, parts: parts.map((x) => x.name) };
  });
try {
  if (lang !== "en") await s.context.addCookies([{ name: "sme_lang", value: lang, url: "https://staging.stack19.com" }]);
  for (const [w, h] of [[1366, 768], [1280, 800], [1920, 1080]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(`${s.base}/quotes`, { waitUntil: "domcontentloaded" });
    await p.locator('[data-ask="orb"]').waitFor({ timeout: 45000 });
    await sleep(1500);
    await p.locator('[data-ask="orb"]').click();
    await p.locator('[data-chat="panel"] [data-chat="form"]').waitFor({ timeout: 20000 });
    await sleep(800);
    const g = await geometry();
    console.log(`-- ${w}x${h} empty: panel ${Math.round(g.panel.w)}x${Math.round(g.panel.h)}, body ${Math.round(g.body.h)}`);
    ok(`${w}x${h} empty panel fits its content (no big blank area)`, g.panel.h <= 460 && g.body.h <= 200, `panel=${Math.round(g.panel.h)} body=${Math.round(g.body.h)}`);
    ok(`${w}x${h} chips directly under the greeting, above the input`, g.chips && g.chips.t < g.form.t && g.chips.t >= g.body.t - 1, g.chips ? `chips.top=${Math.round(g.chips.t)} form.top=${Math.round(g.form.t)}` : "no chips");
    ok(`${w}x${h} nothing overlaps: every control inside the row, none over another, Talk below the row`, g.overlaps.length === 0 && g.outside.length === 0 && g.talkBelow, `overlaps=${g.overlaps} outside=${g.outside} talkBelow=${g.talkBelow} parts=${g.parts}`);
    ok(`${w}x${h} the panel stays inside the window`, g.panel.t >= 0 && g.panel.b <= g.vh && g.panel.r <= g.vw + 1);
    if (w === 1366) await shot(s, `pc-${pack}-${lang}-1366-empty`, { fullPage: false });
  }
  // a conversation: grows, then scrolls
  await p.setViewportSize({ width: 1366, height: 768 });
  await p.goto(`${s.base}/quotes`, { waitUntil: "domcontentloaded" });
  await p.locator('[data-ask="orb"]').waitFor({ timeout: 45000 });
  await p.locator('[data-ask="orb"]').click();
  await p.locator("#chat-input").waitFor({ timeout: 20000 });
  const emptyH = (await geometry()).panel.h;
  for (const q of ["what needs me today?", "who should I call first?", "how much customer money is held?"]) {
    await p.locator("#chat-input").fill(q);
    await p.locator('[data-chat="panel"] button[type="submit"]').click();
    await p.locator('[data-chat="assistant"]').nth(["what needs me today?", "who should I call first?", "how much customer money is held?"].indexOf(q)).waitFor({ timeout: 60000 }).catch(() => null);
    await sleep(1200);
  }
  const g2 = await geometry();
  console.log(`-- conversation: panel ${Math.round(g2.panel.h)} (was ${Math.round(emptyH)}), body scrolls ${g2.bodyScrolls}`);
  ok("with a conversation it grew, up to about 560px", g2.panel.h > emptyH + 40 && g2.panel.h <= 566, `panel=${Math.round(g2.panel.h)}`);
  ok("past that the thread scrolls inside, the bar stays whole", g2.bodyScrolls && g2.overlaps.length === 0 && g2.outside.length === 0 && g2.talkBelow, `scrolls=${g2.bodyScrolls}`);
  await shot(s, `pc-${pack}-${lang}-1366-conversation`, { fullPage: false });
  // phone
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${s.base}/quotes`, { waitUntil: "domcontentloaded" });
  await p.locator('[data-ask="orb"]').waitFor({ timeout: 45000 });
  await p.locator('[data-ask="orb"]').click();
  await p.locator('[data-chat="panel"] [data-chat="form"]').waitFor({ timeout: 20000 });
  await sleep(800);
  const m = await geometry();
  ok("phone: the empty sheet fits its content", m.panel.h <= 460, `sheet=${Math.round(m.panel.h)}`);
  ok("phone: nothing overlaps in the sheet", m.overlaps.length === 0 && m.outside.length === 0 && m.talkBelow, `overlaps=${m.overlaps} outside=${m.outside} parts=${m.parts}`);
  ok("phone: the form fits the width, no sideways scroll", m.form.r <= m.vw && (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)));
  await shot(s, `pc-${pack}-${lang}-phone390-empty`, { fullPage: false });
  await p.locator("#chat-input").fill("what needs me today?");
  await p.locator('[data-chat="panel"] button[type="submit"]').click();
  await p.locator('[data-chat="assistant"]').first().waitFor({ timeout: 60000 }).catch(() => null);
  await sleep(1500);
  const m2 = await geometry();
  ok("phone: with a conversation the sheet grew and the bar is whole", m2.panel.h > m.panel.h + 30 && m2.overlaps.length === 0 && m2.outside.length === 0, `sheet=${Math.round(m2.panel.h)}`);
  await shot(s, `pc-${pack}-${lang}-phone390-conversation`, { fullPage: false });
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 220));
}
await s.browser.close();
process.exit(failed ? 1 : 0);
