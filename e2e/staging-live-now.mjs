// "Live now" as a pill in the top bar (owner 31 Oct), on staging with ACTIVITY_SCREENS=mock (made-up activity for the DEMO workspaces only; it changes every 15 s: a call with chats, then leads being read, then nothing), as a synthetic demo owner. Staging only.
//   node e2e/staging-live-now.mjs [textiles|construction_materials|education] [en|te] [light|dark]
// Desktop 1366 and 1440: no "AI usage today" card and NO "Live now" box in the menu; the pill sits in the top bar BEFORE the bell, a live dot and the first line with a chevron while something is going on (it opens a list of everything, each a link), a plain
// grey "All caught up" when idle. Phone (390): the pill is the dot and a short label in the header, nothing wraps, no sideways scroll. Settings > Plan and usage holds the usage meter. Pictures in ~/Desktop/v2-overnight/shots-df/.
import { session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const lang = process.argv[3] || "en";
const theme = process.argv[4] || "light";
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const s = await session(pack, "desktop");
const p = s.page;
try {
  const cookies = [{ name: "sme_theme", value: theme, url: "https://staging.stack19.com" }];
  if (lang !== "en") cookies.push({ name: "sme_lang", value: lang, url: "https://staging.stack19.com" });
  await s.context.addCookies(cookies);
  for (const [w, h] of [[1366, 768], [1440, 900]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(s.base, { waitUntil: "domcontentloaded" });
    await p.locator('[data-screen="today"] h1').waitFor({ timeout: 45000 });
    await p.locator('[data-live="pill"]').waitFor({ timeout: 30000 });
    const seen = new Set();
    const t0 = Date.now();
    while (Date.now() - t0 < 50000 && !(seen.has("call") && seen.has("leads") && seen.has("idle"))) {
      const state = await p.locator('[data-live="pill"]').getAttribute("data-state");
      const text = ((await p.locator('[data-live="pill"]').innerText()) ?? "").replace(/\s+/g, " ");
      const phase = state === "idle" ? "idle" : /call|కాల్/i.test(text) ? "call" : "leads";
      if (!seen.has(phase)) {
        seen.add(phase);
        console.log(`  ${w}: phase ${phase}: ${text}`);
        if (w === 1366 || phase === "idle") await shot(s, `lp-${pack}-${lang}-${theme}-${w}-${phase}`, { fullPage: false });
      }
      await sleep(1500);
    }
    ok(`${w}x${h} the pill showed a call, leads being read, and a grey 'All caught up'`, seen.size === 3, [...seen].join());
    const g = await p.evaluate(() => {
      const r = (el) => el?.getBoundingClientRect();
      const pill = document.querySelector('[data-live="pill"]');
      const bell = document.querySelector('[data-notify="bell"]');
      const header = document.querySelector("header");
      return { pillInHeader: !!pill && !!header?.contains(pill), beforeBell: !!pill && !!bell && r(pill).right <= r(bell).left + 1, menuHasLive: !!document.querySelector('aside [data-live]'), body: document.body.innerText, h: r(pill)?.height, headerH: r(header)?.height };
    });
    ok(`${w}x${h} in the top bar, before the bell, and no box in the menu`, g.pillInHeader && g.beforeBell && !g.menuHasLive, JSON.stringify({ in: g.pillInHeader, before: g.beforeBell, menu: g.menuHasLive }));
    ok(`${w}x${h} no 'AI usage today' card and no usage meter on Today`, !/AI usage today|% left/i.test(g.body) && (await p.locator('[role="meter"]').count()) === 0);
    if (w === 1366) {
      // wait for an active phase to open the list
      await p.waitForFunction(() => document.querySelector('[data-live="pill"]')?.getAttribute("data-state") === "active", null, { timeout: 40000 }).catch(() => null);
      const btn = p.locator('[data-live="pill"] button');
      if ((await btn.count()) > 0) {
        await btn.click();
        const items = await p.locator('[data-live="pill"] [role="region"] a').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
        ok("the list holds every current item, each a link into the workspace", items.length > 0 && items.every((h) => h?.startsWith("/app/tenants/")), items.join(" "));
        await shot(s, `lp-${pack}-${lang}-${theme}-1366-open`, { fullPage: false });
        await p.keyboard.press("Escape");
      }
    }
  }
  await p.goto(`${s.base}/settings?section=plan`, { waitUntil: "domcontentloaded" });
  await p.locator("#usage-heading").waitFor({ timeout: 45000 }).catch(() => null);
  ok("the AI usage is in Settings, Plan and usage", (await p.locator("#usage-heading").count()) === 1 && (await p.locator('section[aria-labelledby="usage-heading"] [role="meter"]').count()) === 1);
  for (const [w, h] of [[390, 844], [360, 780]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(s.base, { waitUntil: "domcontentloaded" });
    await p.locator('[data-live="pill"]').waitFor({ timeout: 40000 });
    await sleep(1200);
    const m = await p.evaluate(() => {
      const header = document.querySelector("header");
      const hr = header.getBoundingClientRect();
      const kids = [...header.querySelectorAll(":scope > div > *, :scope > a")].map((e) => e.getBoundingClientRect());
      const pill = document.querySelector('[data-live="pill"]').getBoundingClientRect();
      return { headerH: hr.height, scrollW: document.documentElement.scrollWidth, innerW: innerWidth, pillW: pill.width, pillH: pill.height, right: Math.max(...kids.map((k) => k.right)), text: document.querySelector('[data-live="pill"]').innerText.replace(/\s+/g, " ") };
    });
    console.log(`-- phone ${w}: ${JSON.stringify(m)}`);
    ok(`${w}px the pill is in the header (dot + short label), one row, nothing pushed off the screen`, m.headerH <= 80 && m.right <= m.innerW + 1 && m.pillH <= 48, JSON.stringify(m));
    ok(`${w}px no sideways scroll`, m.scrollW <= m.innerW + 1);
    await shot(s, `lp-${pack}-${lang}-${theme}-phone${w}`, { fullPage: false });
  }
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
}
await s.browser.close();
process.exit(failed ? 1 : 0);
