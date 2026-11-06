// The public home page, landing v2 (job landing-v2): pictures and the page's own checks, on a production build (the visual tests' stand-in answers anything the server asks; the home page asks nothing).
//   node e2e/visual/landing-shots.mjs [--no-build] [--out DIR] [--set quick|full]
// quick (the default): 1440, 390 and 360, light, English. full: 1440, 1366, 390 and 360, light and dark, English and Telugu, and a reduced-motion set.
// Checks: no horizontal page scroll (360 above all); Try it (a business and a language, then Send: the caption says that language's line, the matching outcome lights); the page reads without script. Exit 1 when a check fails.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "..", "apps", "web");
const PORT = 3016;
const WEB_URL = `http://127.0.0.1:${PORT}`;
// the public home page reads no API and no session: the build only needs addresses to exist (nothing listens there)
const ENV = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54998", NEXT_PUBLIC_SUPABASE_ANON_KEY: "landing-anon", NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:54998", WAITLIST: "mock", SITE_KYC_COPY: process.env.SITE_KYC_COPY ?? "1" };
const busy = (port) => new Promise((res) => { const s = net.connect(port, "127.0.0.1"); s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); });
async function startApp({ build, log }) {
  if (await busy(PORT)) throw new Error(`port ${PORT} is already in use (it is not killed: free it or wait)`);
  if (build) {
    console.log(`${log}: building the web app`);
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...ENV }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  const web = spawn(process.execPath, [path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: WEB_DIR, env: { ...process.env, ...ENV }, stdio: "ignore" });
  for (let i = 0; i < 120 && !(await busy(PORT)); i++) await new Promise((r) => setTimeout(r, 500));
  return { close: async () => void web.kill("SIGTERM") };
}

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(arg("out", "/Volumes/Stack19/stack19/v2-overnight/shots-landing"));
const SET = arg("set", "quick");
const TAG = arg("tag", "");
const fails = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

async function open(browser, { width, height = 900, theme = "light", lang = "en", motion = "no-preference", script = true }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: motion, javaScriptEnabled: script, timezoneId: "Asia/Kolkata" });
  await ctx.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, { name: "sme_theme", value: theme, url: WEB_URL }]);
  const p = await ctx.newPage();
  await p.goto(`${WEB_URL}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await p.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
  await p.waitForTimeout(script ? 2600 : 300); // the headline's rise and the stage's start-up
  return { ctx, p };
}
const noSideScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (p, name, full = false) => p.screenshot({ path: path.join(OUT, `${TAG}${name}.png`), fullPage: full });

const { close } = await startApp({ build: !process.argv.includes("--no-build"), log: "landing-shots" });
try {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const views =
    SET === "full"
      ? [1440, 1366, 390, 360].flatMap((width) => ["light", "dark"].flatMap((theme) => ["en", "te"].map((lang) => ({ width, theme, lang, height: width < 768 ? 844 : 900 }))))
      : [
          { width: 1440, theme: "light", lang: "en" },
          { width: 390, theme: "light", lang: "en", height: 844 },
          { width: 360, theme: "light", lang: "en", height: 800 }, // the narrow Android phone (owner, 6 Nov 2026)
          { width: 360, theme: "dark", lang: "en", height: 800 }, // and in dark (the core-and-orbit AI team and the Lead Finder carousel, owner 6 Nov 2026)
        ];
  for (const v of views) {
    const { ctx, p } = await open(browser, v);
    const name = `${v.width}-${v.theme}-${v.lang}`;
    check(await noSideScroll(p), `${name}: no horizontal page scroll`);
    await shot(p, `${name}-top`);
    await shot(p, `${name}-full`, true);
    // each section on its own (scrolled into view, a moment to draw; the footer's wordmark takes about 2.5 s to assemble). The sticky header is hidden for these pictures only: in a section picture it would sit
    // over the section's top, which a visitor never sees that way (the real scroll is checked below, with the header in place)
    await p.evaluate(() => void (document.querySelector("header").style.visibility = "hidden"));
    for (const sel of ['[data-part="greetings"]', "#call", "#finder", "#team", "#after", "#number", "#calc", "#plans", "#faq", "#demo", "footer"]) {
      const el = p.locator(sel).first();
      if (!(await el.count())) continue;
      await el.scrollIntoViewIfNeeded();
      await p.waitForTimeout(sel === "footer" ? 3200 : 1800);
      await el.screenshot({ path: path.join(OUT, `${TAG}${name}-${sel.replace(/[^a-z]/g, "") || "section"}.png`) });
    }
    await p.evaluate(() => void (document.querySelector("header").style.visibility = ""));
    // the real scroll: an anchor jump with the sticky header in place, the picture of the screen as a visitor sees it
    for (const id of ["calc", "end"]) {
      await p.evaluate((h) => document.getElementById(h)?.scrollIntoView({ behavior: "instant", block: "start" }), id);
      await p.waitForTimeout(id === "end" ? 3200 : 1200);
      await shot(p, `${name}-at-${id}`);
    }
    // the very end of the page as a visitor scrolls to it: on a phone the footer is taller than the screen, so its section picture above can show the wordmark's canvas before it has drawn (off screen, it waits)
    await p.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await p.waitForTimeout(3600);
    await shot(p, `${name}-page-end`);
    await ctx.close();
  }
  // the phone's meeting scene (#team) and radar (#finder), the desktop's designs scaled (owner, 6 Nov 2026), at 320-412 px and with Android's large text (115%): no two helper names touch, no name touches
  // another helper, and nothing in either section reaches past the screen
  for (const width of [320, 360, 375, 390, 412])
    for (const big of [false, true]) {
      const { ctx, p } = await open(browser, { width, height: 800 });
      if (big) await p.evaluate(() => { const els = [...document.querySelectorAll("body *")]; const fs = els.map((el) => parseFloat(getComputedStyle(el).fontSize)); els.forEach((el, i) => el.style.setProperty("font-size", `${fs[i] * 1.15}px`)); });
      await p.locator("#team").scrollIntoViewIfNeeded();
      await p.waitForTimeout(600);
      const r = await p.evaluate((W) => {
        const box = (el) => el.getBoundingClientRect();
        const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        const labels = [...document.querySelectorAll("[data-seat-label]")].map(box);
        const seats = [...document.querySelectorAll("[data-seat-phone]")].map(box);
        let touch = 0;
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) if (hit(labels[i], labels[j])) touch++;
          seats.forEach((s, j) => { if (j !== i && hit(labels[i], s)) touch++; });
        }
        const wide = ["#team", "#finder"].flatMap((id) => [...document.querySelectorAll(`${id} *`)].filter((el) => { const b = box(el); if (!b.width || el.closest('[class*="overflow-x-auto"]') || el.closest('[aria-hidden="true"]') || (b.width <= 1 && b.height <= 1)) return false; return b.right > W + 1 || b.left < -1; }).map((el) => `${id} ${el.tagName.toLowerCase()} "${(el.textContent || "").trim().slice(0, 24)}"`));
        return { labels: labels.length, touch, wide: wide.slice(0, 4) };
      }, width);
      const tag = `${width}${big ? " at 115% text" : ""}`;
      check(r.labels === 6 && r.touch === 0, `${tag}: the six helper names under the phone's meeting scene touch nothing (${r.touch} touching)`);
      check(r.wide.length === 0, `${tag}: nothing in the AI team or the Lead Finder is wider than the screen${r.wide.length ? ` (${r.wide.join("; ")})` : ""}`);
      await ctx.close();
    }
  // the phone header (landing v2 phone design): the one button stays in the bar in every language, nothing spills past the edge; the language and the theme are in the menu
  for (const width of [360, 390])
    for (const lang of ["en", "te", "hi", "kn"]) {
      const { ctx, p } = await open(browser, { width, height: 844, lang });
      const fit = await p.evaluate(() => {
        const bar = document.querySelector("header");
        const btn = [...(bar?.querySelectorAll('a[href="#demo"]') ?? [])].find((a) => a.getBoundingClientRect().width > 0);
        const r = btn?.getBoundingClientRect();
        return { btn: Boolean(r && r.right <= window.innerWidth - 8 && r.left >= 0), row: [...(bar?.querySelectorAll("*") ?? [])].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 1 || el.closest("details nav")) };
      });
      check(fit.btn && fit.row, `${width}-${lang}: the header's button is in the bar and nothing spills over`);
      await p.click("header summary");
      await p.waitForTimeout(300);
      check(await p.locator("header details nav select").isVisible(), `${width}-${lang}: the menu holds the language`);
      await p.screenshot({ path: path.join(OUT, `${TAG}${width}-${lang}-menu.png`) });
      await ctx.close();
    }
  // Try it: Pavers, Hindi, Send -> the caption says the Hindi line, and the quote outcome lights
  {
    const { ctx, p } = await open(browser, { width: 1440 });
    await p.click('[data-part="try"] [data-try-biz="build"]');
    await p.click('[data-part="try"] [data-try-lang="hi"]');
    await p.click('[data-part="try"] [data-part="send"]');
    await p.waitForFunction(() => document.querySelector('[data-part="hero-stage"]')?.getAttribute("data-lit-out") === "1", null, { timeout: 30_000 }).catch(() => null);
    const said = await p.evaluate(() => document.querySelector('[data-part="caption"] [data-part="caption-words"]')?.textContent?.trim() ?? "");
    check(said.startsWith("नमस्ते! आपने अभी जो पूछताछ भेजी"), `Try it: the caption says the Hindi line (${said.slice(0, 40)})`);
    check((await p.locator('[data-out="1"][data-lit]').count()) === 1, "Try it: the quote outcome lights");
    await shot(p, "try-pavers-hindi");
    await ctx.close();
  }
  // Hear a call: the tabs change the call (Building materials is in Hindi; Colleges in English)
  {
    const { ctx, p } = await open(browser, { width: 1440 });
    await p.locator("#call").scrollIntoViewIfNeeded();
    await p.click('[data-call-tab="build"]');
    await p.waitForTimeout(400);
    check((await p.locator('[data-part="call-demo"][data-biz="build"] [lang="hi"][data-part="call-words"]').count()) === 1, "call tabs: Building materials shows the Hindi call");
    await p.click('[data-call-tab="coach"]');
    await p.waitForTimeout(400);
    check((await p.locator('[data-part="call-demo"][data-biz="coach"]').count()) === 1 && (await p.locator('[data-call-tab="coach"][aria-selected="true"]').count()) === 1, "call tabs: Colleges is selected");
    // the radar: another city, its own area names
    await p.locator("#finder").scrollIntoViewIfNeeded();
    await p.click('[data-part="radar"] .lg\\:block [data-city="Chennai"]');
    await p.waitForTimeout(6000); // one sweep finds them again
    const found = await p.locator("#finder [data-found]").allTextContents();
    check(found.some((x) => /T\. Nagar|Velachery|Mylapore|Anna Nagar/.test(x)) && !found.some((x) => /Ameerpet|Kukatpally/.test(x)), `radar: Chennai's own areas (${found.length} found)`);
    await shot(p, "radar-chennai");
    // the questions open and close
    const q = p.locator('#faq [data-faq="8"]');
    await q.locator("summary").click();
    check(await q.evaluate((d) => d.open), "FAQ: a question opens");
    await q.locator("summary").click();
    check(!(await q.evaluate((d) => d.open)), "FAQ: and closes again");
    // the closing form: the mock waitlist takes it and thanks the visitor
    const form = p.locator('[data-part="waitlist"][data-variant="bar"]');
    await form.scrollIntoViewIfNeeded();
    await form.locator("#join-name").fill("Lakshmi (example)");
    await form.locator("#join-contact").fill("+91 90000 00000");
    await form.locator("#join-city").fill("Vijayawada");
    await form.locator('button[type="submit"]').click();
    await p.waitForSelector('[data-part="waitlist-thanks"]', { timeout: 15_000 }).catch(() => null);
    check((await p.locator('[data-part="waitlist-thanks"]').count()) === 1, "waitlist: the closing form is sent and says thank you");
    await shot(p, "join-thanks");
    await ctx.close();
  }
  // a jump to a part of the page lands below the sticky header (scroll-margin-top)
  {
    const { ctx, p } = await open(browser, { width: 1440 });
    for (const id of ["finder", "team", "end"]) {
      await p.evaluate((x) => { location.hash = ""; location.hash = x; }, id);
      await p.waitForTimeout(600);
      const gap = await p.evaluate((x) => document.getElementById(x).getBoundingClientRect().top - document.querySelector("header").getBoundingClientRect().bottom, id);
      check(gap >= 0, `#${id}: lands below the header (${Math.round(gap)} px)`);
    }
    await ctx.close();
  }
  // reduced motion: one still frame, the whole line shown
  {
    const { ctx, p } = await open(browser, { width: 1440, motion: "reduce" });
    const said = await p.evaluate(() => [...document.querySelectorAll('[data-part="caption"] .h2-w')].every((e) => e.hasAttribute("data-said")));
    check(said, "reduced motion: the caption's whole line is shown");
    await shot(p, "1440-reduced-motion-top");
    await ctx.close();
  }
  // no script: the words are all there
  {
    const { ctx, p } = await open(browser, { width: 1440, script: false });
    const t = await p.evaluate(() => document.body.innerText);
    check(t.includes("Every enquiry answered.") && t.includes("Send an enquiry") && t.includes("Facebook and Instagram ads"), "without script: the hero reads fully");
    await ctx.close();
  }
  await browser.close();
  console.log(`landing-shots: pictures in ${OUT}`);
} finally {
  await close();
}
if (fails.length) process.exitCode = 1;
