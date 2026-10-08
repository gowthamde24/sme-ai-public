// npm run audit:auth [-- --engine chrome|webkit|firefox]: the page checks for the sign-in and account screens that a
// browser can load WITHOUT a session (Stage 3), on the real compiled app served by `next start` (run `npm run build`
// first) with the dummy public Supabase settings (host example.invalid, never contacted). NOT in `npm test`, NOT in CI.
// Screens: /login, /login?notice=reset, /login?notice=link, /login after a rejected submit (a malformed address is
// refused by the server action BEFORE any network call, so the error state is real and offline), /auth/forgot,
// /auth/confirm without a token (the error state) and with a token (the form state).
// /auth/mfa and /auth/set-password redirect to /login without a session: they cannot be loaded here (unit tests, the
// skin contract and lane A's e2e run cover them).
// Checks: structure (one h1, one banner, one main#main, one skip link, the form region lang="en" inside the content
// language, labels and names, the unchanged title, robots noindex,nofollow), no sideways scroll at 360, 390, 768, 1024
// and 1440 with the h1 and the main action in the first screen, text at least 14px, computed contrast in light and dark,
// touch targets (44px on a phone), a real Tab-key walk with ring contrast, 0 CSP violations and 0 console messages.
// Exit 1 on any failure. The numbers are printed, not summarised.
import { chromeEngine } from "./lib/engines.mjs";
import { LANGS, startNext } from "./lib/next-server.mjs";
import { AUTH_STRUCTURE, FOCUSABLE_COUNT, FOCUS_STATE, LAYOUT, TEXT_AND_TARGETS } from "./lib/page-checks.mjs";
import { startTlsProxy } from "./lib/tls-proxy.mjs";

const argv = process.argv.slice(2);
const engineName = argv.includes("--engine") ? argv[argv.indexOf("--engine") + 1] : "chrome";
const SIZES = [[360, 780], [390, 844], [768, 1024], [1024, 768], [1440, 800]];
const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const T = " · SME AI Revenue Engine";

const SCREENS = [
  { id: "login", path: "/login", title: `Sign in${T}`, forms: 1 },
  { id: "login-notice-reset", path: "/login?notice=reset", title: `Sign in${T}`, forms: 1 },
  { id: "login-notice-link", path: "/login?notice=link", title: `Sign in${T}`, forms: 1 },
  { id: "login-rejected", path: "/login", title: `Sign in${T}`, forms: 1, rejected: true },
  { id: "forgot", path: "/auth/forgot", title: `Reset your password${T}`, forms: 1 },
  { id: "confirm-error", path: "/auth/confirm", title: `Confirm${T}`, forms: 0 },
  { id: "confirm-form", path: `/auth/confirm?type=invite&token_hash=${TOKEN}`, title: `Confirm${T}`, forms: 1 },
];

let failed = false;
const healthLines = [];
function report(line, problems = []) {
  console.log(`${problems.length ? "FAIL" : "ok  "}  ${line}`);
  for (const p of problems.slice(0, 8)) console.error(`        ${p}`);
  if (problems.length > 8) console.error(`        ... and ${problems.length - 8} more`);
  if (problems.length) failed = true;
}

async function engineFor(name) {
  if (name === "chrome") return chromeEngine();
  const { playwrightEngine } = await import("./lib/engines-playwright.mjs");
  return playwrightEngine(name);
}

const engine = await engineFor(engineName);
const app = await startNext();
console.log(`engine ${engine.name}: ${engine.note}`);
console.log(`next start pid ${app.pid} on ${app.base} (stopped by PID at the end)`);
const tls = engine.needsHttps ? await startTlsProxy(app.base) : null;
const base = tls ? tls.base : app.base;
if (tls) console.log(`served over https for this engine through a local proxy at ${base} (self-signed certificate, see scripts/lib/tls-proxy.mjs)`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Opens a screen; for the rejected state submits a malformed address and waits for the server's answer. */
async function withScreen(screen, opts, fn) {
  const { lang = "en", width = 1440, height = 900, dark = false } = opts;
  const page = await engine.open({ width, height, dark, reducedMotion: true });
  try {
    await page.setCookie(base, "sme_lang", lang);
    await page.goto(`${base}${screen.path}`, 700);
    if (screen.rejected) {
      await page.eval(`(() => { const f = document.querySelector('form'); f.querySelector('input[name=email]').value = 'a@b'; f.querySelector('input[name=password]').value = 'x'; f.requestSubmit(); })()`);
      for (let i = 0; i < 40; i++) {
        if (await page.eval(`!!document.querySelector('form [role="alert"]')`)) break;
        await sleep(200);
      }
      const alert = await page.eval(`(document.querySelector('form [role="alert"]') || {}).textContent || null`);
      if (alert !== "Enter a valid email and password.") throw new Error(`the rejected state did not appear (alert: ${alert})`);
    }
    const result = await fn(page);
    healthLines.push({ where: `${screen.id} ${lang} ${width}x${height} ${dark ? "dark" : "light"}`, csp: await page.csp(), logs: page.getLogs() });
    return result;
  } finally {
    await page.close();
  }
}

const FIRST_SCREEN = `(() => { const b = (e) => (e ? Math.round(e.getBoundingClientRect().bottom) : null);
  const action = document.querySelector('main button[type="submit"]') || document.querySelector('main a');
  return { h1: b(document.querySelector('h1')), action: b(action), card: b(document.querySelector('main')) }; })()`;

try {
  // ------------------------------------------------------------------ structure
  const structureRuns = [
    ...SCREENS.flatMap((s) => [{ s, lang: "en", dark: false }, { s, lang: "en", dark: true }]),
    ...LANGS.filter((l) => l !== "en").map((lang) => ({ s: SCREENS[0], lang, dark: false })),
  ];
  for (const { s, lang, dark } of structureRuns) {
    const { problems, info } = await withScreen(s, { lang, dark }, (p) => p.eval(AUTH_STRUCTURE({ lang, forms: s.forms, title: s.title })));
    report(`structure ${s.id} ${lang} ${dark ? "dark" : "light"}: h1=${info.h1} main#main=${info.main} banner=${info.banner} skip links=${info.skipLinks} forms=${info.forms} wrapper lang=${info.rootLang} form region lang=${info.regionLang} robots="${info.robots}" title ok`, problems);
  }

  // ------------------------------------------------------------------- layout
  const layoutRuns = [...SCREENS.map((s) => ({ s, lang: "en" })), ...LANGS.filter((l) => l !== "en").map((lang) => ({ s: SCREENS[0], lang }))];
  for (const { s, lang } of layoutRuns) {
    for (const [width, height] of SIZES) {
      const r = await withScreen(s, { lang, width, height }, async (p) => ({ lay: await p.eval(LAYOUT), fs: await p.eval(FIRST_SCREEN) }));
      const problems = [];
      if (r.lay.docScrollWidth > r.lay.viewportW) problems.push(`the page scrolls sideways: scrollWidth ${r.lay.docScrollWidth} > ${r.lay.viewportW}`);
      problems.push(...r.lay.offenders.map((o) => `sticks out of the screen: ${o}`));
      for (const [what, bottom] of [["h1", r.fs.h1], ["main action", r.fs.action]]) {
        if (bottom == null) problems.push(`${what} not found`);
        else if (bottom > height) problems.push(`${what} ends at ${bottom}, below the first screen (${height})`);
      }
      report(`layout ${s.id} ${lang} ${width}x${height}: scrollWidth ${r.lay.docScrollWidth}/${r.lay.viewportW}; first screen ${height}: h1 ${r.fs.h1}, action ${r.fs.action}, card ends ${r.fs.card}`, problems);
    }
  }

  // ------------------------------------------------- text, contrast, targets
  const textRuns = [
    ...SCREENS.flatMap((s) => [false, true].flatMap((dark) => [[360, 780, true], [1440, 900, false]].map(([width, height, phone]) => ({ s, lang: "en", dark, width, height, phone })))),
    ...LANGS.filter((l) => l !== "en").flatMap((lang) => [false, true].map((dark) => ({ s: SCREENS[0], lang, dark, width: 360, height: 780, phone: true }))),
  ];
  for (const { s, lang, dark, width, height, phone } of textRuns) {
    const r = await withScreen(s, { lang, dark, width, height }, (p) => p.eval(TEXT_AND_TARGETS(phone)));
    const problems = [
      ...r.small.map((x) => `text under 14px: ${x}`),
      ...r.contrast.map((x) => `contrast: ${x}`),
      ...r.unknown.map((x) => `contrast unknown: ${x}`),
      ...r.targets.map((x) => `target under ${r.targetMin}px: ${x}`),
    ];
    report(`text ${s.id} ${lang} ${dark ? "dark" : "light"} ${width}px: ${r.texts} text elements (smallest ${r.minFont}px), contrast on ${r.checkedText} (tightest ${r.worstRatioOverNeed}x its requirement), ${r.interactive} controls at least ${r.targetMin}px`, problems);
  }

  // --------------------------------------------------------------------- focus
  const focusRuns = [
    { s: SCREENS[0], lang: "en", dark: false, width: 1440, height: 900 },
    { s: SCREENS[0], lang: "en", dark: true, width: 1440, height: 900 },
    { s: SCREENS[0], lang: "en", dark: false, width: 390, height: 844 },
    { s: SCREENS[0], lang: "kn", dark: false, width: 1440, height: 900 },
    { s: SCREENS[4], lang: "en", dark: false, width: 1440, height: 900 },
    { s: SCREENS[6], lang: "en", dark: false, width: 1440, height: 900 },
  ];
  for (const run of focusRuns) {
    const r = await withScreen(run.s, run, async (p) => {
      const total = await p.eval(FOCUSABLE_COUNT);
      const stops = [];
      for (let i = 0; i < total + 4; i++) {
        await p.pressTab();
        const st = await p.eval(FOCUS_STATE);
        if (!st) break;
        if (stops.length && stops[0].name === st.name) break;
        stops.push(st);
      }
      return { total, stops };
    });
    const problems = [];
    for (const st of r.stops) {
      if (!st.hasOutline && !st.hasShadow) problems.push(`no visible focus ring on ${st.name}`);
      else if (st.hasOutline && st.ratio < 3) problems.push(`focus ring contrast ${st.ratio}:1 on ${st.name}`);
    }
    if (r.stops.length < r.total) problems.push(`the Tab key reached ${r.stops.length} of ${r.total} controls`);
    const low = r.stops.filter((x) => x.hasOutline).map((x) => x.ratio);
    report(`focus ${run.s.id} ${run.lang} ${run.dark ? "dark" : "light"} ${run.width}px: ${r.stops.length} tab stops of ${r.total} controls; lowest ring contrast ${low.length ? Math.min(...low).toFixed(2) : "n/a"}:1`, problems);
  }

  // -------------------------------------------------------------------- health
  {
    const problems = [];
    let violations = 0;
    let messages = 0;
    let known = 0;
    for (const h of healthLines) {
      violations += h.csp.length;
      for (const c of h.csp) problems.push(`CSP violation on ${h.where}: ${c}`);
      for (const l of h.logs) {
        if (/preloaded with link preload was not used/.test(l)) known++; // Firefox, see the Stage 2 report, finding 1
        else {
          messages++;
          problems.push(`console on ${h.where}: ${l}`);
        }
      }
    }
    report(`health: ${healthLines.length} page loads, ${violations} CSP violations, ${messages} console errors or warnings${known ? `; plus ${known} known Firefox font-preload warning(s)` : ""}`, problems);
  }
} finally {
  await engine.stop();
  tls?.stop();
  app.stop();
}
console.log(failed ? "\nAUTH AUDIT FAILED" : "\nAUTH AUDIT PASSED");
process.exit(failed ? 1 : 0);
