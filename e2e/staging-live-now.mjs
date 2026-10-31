// "Live now" instead of usage (owner 31 Oct), on staging with ACTIVITY_SCREENS=mock (the mock changes every 15 s: a call with chats, then leads being read, then nothing), as a synthetic demo owner. Staging only.
//   node e2e/staging-live-now.mjs [textiles|construction_materials|education] [en|te]
// Desktop: the menu has NO "AI usage today" card; the "Live now" strip sits at the bottom of the menu and shows each kind of work as a link (or "All caught up"); Today has no usage meter; Settings > Plan and usage holds the usage meter.
// Phone (390, 360): no usage card in the More sheet, a slim "Live now" line under the header (one line, no wrapping), no sideways scroll. Pictures in ~/Desktop/v2-overnight/shots-df/.
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
  await p.setViewportSize({ width: 1366, height: 768 });
  await p.goto(s.base, { waitUntil: "domcontentloaded" });
  await p.locator('[data-screen="today"] h1').waitFor({ timeout: 45000 });
  await p.locator('[data-live="side"]').waitFor({ timeout: 30000 });
  // the three phases of the mock: wait until each has been seen (about 45 s at most)
  const seen = new Set();
  const t0 = Date.now();
  let shotCall = false, shotLeads = false, shotIdle = false;
  while (Date.now() - t0 < 50000 && !(seen.has("call") && seen.has("leads") && seen.has("idle"))) {
    const links = await p.locator('[data-live="side"] a').count();
    const text = (await p.locator('[data-live="side"]').innerText()).replace(/\s+/g, " ");
    const phase = links === 0 ? "idle" : /call/i.test(text) || lang !== "en" && links >= 2 ? "call" : "leads";
    if (!seen.has(phase)) {
      seen.add(phase);
      console.log(`  phase ${phase}: ${text}`);
      if (phase === "call" && !shotCall) { shotCall = true; await shot(s, `ln-${pack}-${lang}-1366-call`, { fullPage: false }); }
      if (phase === "leads" && !shotLeads) { shotLeads = true; await shot(s, `ln-${pack}-${lang}-1366-leads`, { fullPage: false }); }
      if (phase === "idle" && !shotIdle) { shotIdle = true; await shot(s, `ln-${pack}-${lang}-1366-idle`, { fullPage: false }); }
    }
    await sleep(1500);
  }
  ok("the strip showed a call with chats, leads being read, and 'All caught up' as the mock moved on", seen.size === 3, [...seen].join());
  const body = await p.evaluate(() => document.body.innerText);
  ok("no 'AI usage today' card in the menu and no usage meter on Today", !/AI usage today|% left/i.test(body) && (await p.locator('[role="meter"]').count()) === 0);
  const geo = await p.evaluate(() => {
    const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const side = r('[data-live="side"]');
    const aside = r("aside");
    return { sideBottom: side ? side.bottom : null, asideBottom: aside?.bottom, w: side?.width };
  });
  ok("the strip sits at the bottom of the menu, inside it", geo.sideBottom !== null && geo.sideBottom <= geo.asideBottom, JSON.stringify(geo));
  // a tap goes to what it is about
  await p.waitForFunction(() => document.querySelectorAll('[data-live="side"] a').length > 0, null, { timeout: 40000 }).catch(() => null);
  const hrefs = await p.locator('[data-live="side"] a').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  ok("each line is a link into the workspace (call, chats, leads)", hrefs.length > 0 && hrefs.every((h) => h?.startsWith(`/app/tenants/`)), hrefs.join(" "));
  // Settings > Plan and usage
  await p.goto(`${s.base}/settings?section=plan`, { waitUntil: "domcontentloaded" });
  await p.locator("#usage-heading").waitFor({ timeout: 45000 }).catch(() => null);
  ok("the AI usage is in Settings, Plan and usage", (await p.locator('#usage-heading').count()) === 1 && (await p.locator('[role="meter"]').count()) === 1);
  await shot(s, `ln-${pack}-${lang}-settings-plan`, { fullPage: false });
  // phones
  for (const [w, h] of [[390, 844], [360, 780]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(s.base, { waitUntil: "domcontentloaded" });
    await p.locator('[data-live="line"]').waitFor({ timeout: 40000 });
    await sleep(1200);
    const m = await p.evaluate(() => {
      const line = document.querySelector('[data-live="line"]');
      const header = document.querySelector("header")?.getBoundingClientRect();
      const r = line?.getBoundingClientRect();
      return { top: r?.top, h: r?.height, headerBottom: header?.bottom, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, text: line?.textContent, oneLine: line ? line.scrollHeight <= line.clientHeight + 1 : false };
    });
    console.log(`-- phone ${w}: ${JSON.stringify(m)}`);
    ok(`${w}px a slim status line under the header, one line`, !!m.h && m.h <= 44 && Math.abs(m.top - m.headerBottom) <= 2 && m.oneLine, `h=${m.h} top=${m.top} headerBottom=${m.headerBottom}`);
    ok(`${w}px no sideways scroll`, m.scrollW <= m.innerW + 1);
    await shot(s, `ln-${pack}-${lang}-phone${w}`, { fullPage: false });
    if (w === 390) {
      await p.getByRole("button", { name: /^(More|మరిన్ని)/ }).click().catch(() => null);
      await sleep(700);
      ok("no AI usage card in the More sheet", !/AI usage today|% used/i.test(await p.evaluate(() => document.body.innerText)));
      await shot(s, `ln-${pack}-${lang}-phone${w}-more`, { fullPage: false });
    }
  }
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
}
await s.browser.close();
process.exit(failed ? 1 : 0);
