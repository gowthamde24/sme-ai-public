// npm run audit:leaks: the CSS-leak audit for design v2 (ADR 0060). NOT part of `npm test` and NOT in CI (it needs a
// system Chrome); run it at every stage STOP. It checks, in order:
//   1. the source rules (no legacy class names, no inline style next to classes, v2 stylesheets fully scoped);
//   2. in headless Chrome: the detector's own self-test, then the fixture audit (real legacy CSS + real compiled v2 CSS
//      + the probe markup), in light and dark.
//   3. PAGE MODE (Stage 2): the real, compiled /landing served by `next start` (run `npm run build` first), in light and
//      dark and in all four languages: the same classification on every element inside [data-ui="v2"], with the legacy
//      sheet found by content. Then a soft navigation from the header's "Sign in" link to /login (the v2 sheet stays in the
//      document; no existing custom property is overridden).
//      And the LEGACY PROBE (Stage 3): scripts/audit/legacy-probe.html, markup built from the real legacy class names, is
//      injected into the page (outside [data-ui="v2"]) and every computed property of every probe element is compared
//      with the v2 sheet on and off. It replaces "navigate to a legacy page" as the proof that v2 does not reach the legacy
//      screens, because no screen that loads without a session is a legacy screen any more.
// Exit 1 if: a source rule fails, the detector cannot tell a leak from no leak, any OVERRIDE leak or SHADOWED utility
// exists, any BASE leak is outside the allow-list, or the legacy probe changes when the v2 sheet is toggled.
// `--source-only` skips the browser steps; `--fixture-only` skips page mode; `--path /` audits "/" instead of /landing.
import fs from "node:fs";
import path from "node:path";

import { sleep, startChrome, Tab } from "./lib/chrome.mjs";
import { BASE_ALLOW, ROOT, auditLoadedPage, detectorSelfTest, runFixtureAudit } from "./lib/leak-audit.mjs";
import { LANGS, startNext } from "./lib/next-server.mjs";
import { checkSource, legacyClassNames, legacyRules, sourceCheckSelfTest, unscopedSelectors } from "./lib/source-check.mjs";

const rel = (p) => path.relative(ROOT, p);
const walk = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : [];

/** v2 code: everything under components/v2 and design, plus any app/ file that imports from components/v2 or renders data-ui="v2". */
function v2Sources() {
  const own = [...walk(path.join(ROOT, "components/v2")), ...walk(path.join(ROOT, "design"))].filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
  const app = walk(path.join(ROOT, "app")).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f) && /components\/v2|data-ui="v2"/.test(fs.readFileSync(f, "utf8")));
  return [...new Set([...own, ...app])];
}

/** Every property of every element outside [data-ui="v2"] with the v2 sheet on and off; any difference is a reverse leak. */
const REVERSE_JS = `(() => {
  const text = (s) => { try { return [...s.cssRules].map((r) => r.cssText).join(''); } catch { return ''; } };
  const v2 = [...document.styleSheets].find((s) => /data-ui="v2"/.test(text(s)));
  const els = [...document.querySelectorAll('html, body, body *')].filter((e) => !e.closest('[data-ui="v2"]') && !['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT'].includes(e.tagName));
  if (!v2) return { v2SheetPresent: false, path: location.pathname, elements: els.length, diffs: [], overridden: [], added: 0 };
  const snap = () => els.map((e) => { const cs = getComputedStyle(e); return Object.fromEntries([...cs].map((p) => [p, cs.getPropertyValue(p)])); });
  const on = snap();
  v2.disabled = true;
  const off = snap();
  v2.disabled = false;
  const diffs = [], overridden = [], added = new Set();
  els.forEach((e, i) => {
    for (const p of new Set([...Object.keys(on[i]), ...Object.keys(off[i])])) {
      if (on[i][p] === off[i][p]) continue;
      const where = e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 30) + ' ' + p;
      if (!p.startsWith('--')) diffs.push(where + ': ' + off[i][p] + ' -> ' + on[i][p]);
      else if (off[i][p] === undefined || off[i][p] === '') added.add(p);
      else overridden.push(where);
    }
  });
  return { v2SheetPresent: true, path: location.pathname, elements: els.length, diffs, overridden, added: added.size };
})()`;

const pagePath = process.argv.includes("--path") ? process.argv[process.argv.indexOf("--path") + 1] : "/landing";

/** Injects the legacy probe and compares every standard property of its elements with the v2 sheet on and off. */
const PROBE_JS = (html) => `(() => {
  const text = (s) => { try { return [...s.cssRules].map((r) => r.cssText).join(''); } catch { return ''; } };
  const sheets = [...document.styleSheets];
  const v2 = sheets.find((s) => /data-ui="v2"/.test(text(s)));
  const legacy = sheets.find((s) => /\\.shell\\b/.test(text(s)) && /\\.card\\b/.test(text(s)));
  if (!v2 || !legacy) throw new Error('probe: v2 sheet ' + !!v2 + ', legacy sheet ' + !!legacy);
  document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(html)});
  const els = [...document.querySelectorAll('#legacy-probe, #legacy-probe *')];
  const snap = () => els.map((e) => { const cs = getComputedStyle(e); return Object.fromEntries([...cs].filter((p) => !p.startsWith('--')).map((p) => [p, cs.getPropertyValue(p)])); });
  const both = snap();
  v2.disabled = true; const withoutV2 = snap(); v2.disabled = false;
  legacy.disabled = true; const withoutLegacy = snap(); legacy.disabled = false;
  const diffs = [], legacyEffect = new Set();
  els.forEach((e, i) => {
    for (const p of Object.keys(both[i])) {
      if (both[i][p] !== withoutV2[i][p]) diffs.push(e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 30) + ' ' + p + ': ' + withoutV2[i][p] + ' -> ' + both[i][p]);
      if (both[i][p] !== withoutLegacy[i][p]) legacyEffect.add(e.tagName.toLowerCase() + ' ' + p);
    }
  });
  return { elements: els.length, diffs, legacyEffect: legacyEffect.size, classes: new Set([...document.querySelectorAll('#legacy-probe [class]')].flatMap((e) => String(e.className).split(/\\s+/))).size };
})()`;

async function pageMode(chrome) {
  const app = await startNext();
  console.log(`next start pid ${app.pid} on ${app.base} (stopped by PID at the end)`);
  try {
    for (const lang of LANGS) {
      for (const dark of [false, true]) {
        const tab = await Tab.open(chrome.port, { dark });
        try {
          await tab.setCookie(app.base, "sme_lang", lang);
          await tab.goto(`${app.base}${pagePath}`);
          const r = await auditLoadedPage(tab);
          const csp = await tab.csp();
          console.log(`page audit, ${lang}, ${dark ? "dark" : "light"}: elements=${r.elements} | OVERRIDE leaks=${r.override.length} | SHADOWED utilities=${r.shadowed.length} | BASE leaks outside the allow-list=${r.base.length} (allow-listed derived values: ${r.allowListed}) | CSP violations=${csp.length}`);
          for (const l of [...r.override, ...r.shadowed, ...r.base].slice(0, 10)) console.error(`  ${l}`);
          if (r.override.length) fail(`${lang} ${dark ? "dark" : "light"}: ${r.override.length} override leak(s) on the real page`);
          if (r.shadowed.length) fail(`${lang} ${dark ? "dark" : "light"}: ${r.shadowed.length} utility declaration(s) do not win the cascade on the real page`);
          if (r.base.length) fail(`${lang} ${dark ? "dark" : "light"}: ${r.base.length} base leak(s) on the real page`);
          if (csp.length) fail(`${lang} ${dark ? "dark" : "light"}: CSP violations: ${csp.join("; ")}`);
          if (!r.elements) fail("page mode found no element inside [data-ui=\"v2\"]");
        } finally {
          await tab.close();
        }
      }
    }
    // Soft navigation keeps the v2 sheet in the document (Stage 0 finding); the legacy probe then proves it does not reach legacy markup.
    for (const dark of [false, true]) {
      const tab = await Tab.open(chrome.port, { dark });
      try {
        await tab.goto(`${app.base}${pagePath}`);
        await tab.eval(`document.querySelector('a[href="/login"]').click()`);
        const t0 = Date.now();
        while (Date.now() - t0 < 10000 && (await tab.eval("location.pathname")) !== "/login") await sleep(150);
        await sleep(800);
        const r = await tab.eval(REVERSE_JS);
        // Since Stage 3 /login is a v2 page, so html and body size depend on v2 content and a property-by-property comparison of
        // "the legacy page" means nothing here: the legacy probe below is the comparison. What this step still proves: the soft
        // navigation reaches /login with the v2 sheet in the document, and the sheet overrides no existing custom property.
        console.log(`soft navigation, ${dark ? "dark" : "light"}: landed on ${r.path}; v2 sheet still in the document=${r.v2SheetPresent}; existing custom properties it overrides=${r.overridden.length}; new custom properties it adds on :root (Tailwind theme variables, unused by the legacy pages)=${r.added}`);
        if (r.path !== "/login") fail("the soft navigation from the landing did not reach /login");
        if (!r.v2SheetPresent) fail("the v2 sheet is not in the document after the soft navigation: the probe below would test nothing");
        if (r.overridden.length) fail(`soft navigation ${dark ? "dark" : "light"}: the v2 sheet overrides existing custom properties: ${r.overridden.slice(0, 8).join("; ")}`);
      } finally {
        await tab.close();
      }
    }
    // Legacy probe: legacy markup with the v2 sheet in the document, on a phone width too (the legacy sheet has phone rules).
    const probeHtml = fs.readFileSync(path.join(ROOT, "scripts/audit/legacy-probe.html"), "utf8");
    for (const [width, dark] of [[1200, false], [1200, true], [390, false], [390, true]]) {
      const tab = await Tab.open(chrome.port, { width, height: 800, dark });
      try {
        await tab.goto(`${app.base}${pagePath}`);
        const r = await tab.eval(PROBE_JS(probeHtml));
        console.log(`legacy probe, ${width}px ${dark ? "dark" : "light"}: ${r.elements} elements, ${r.classes} legacy classes used; properties the legacy sheet itself changes=${r.legacyEffect} (the probe is not vacuous); properties that change with the v2 sheet on/off=${r.diffs.length}`);
        if (!r.legacyEffect) fail("the legacy probe is vacuous: the legacy sheet changes nothing on it");
        if (r.diffs.length) fail(`legacy probe ${width}px ${dark ? "dark" : "light"}: the v2 sheet changes legacy markup: ${r.diffs.slice(0, 8).join("; ")}`);
      } finally {
        await tab.close();
      }
    }
  } finally {
    app.stop();
  }
}

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`FAIL  ${msg}`);
};

// 1. source rules
const self = sourceCheckSelfTest();
console.log(`source check self-test: ${self.ok ? "ok" : "FAILED"} ${JSON.stringify(self.detail)}`);
if (!self.ok) fail("the source check cannot recognise its own fixtures");
const legacyCss = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
const legacy = legacyRules(legacyCss);
const files = v2Sources();
let violations = 0;
for (const f of files) {
  for (const v of checkSource(fs.readFileSync(f, "utf8"), rel(f), legacy)) {
    violations++;
    console.error(`  ${v.file}:${v.line} ${v.rule}: ${v.detail}`);
  }
}
for (const css of ["design/tokens.css", "design/reset.css", "design/base.css"]) {
  for (const sel of unscopedSelectors(fs.readFileSync(path.join(ROOT, css), "utf8"))) {
    violations++;
    console.error(`  ${css}: selector outside [data-ui="v2"]: ${sel}`);
  }
}
console.log(`source check: ${files.length} v2 source file(s), ${legacyClassNames(legacyCss).size} legacy class names (${legacy.single.size} standalone, ${legacy.multi.length} combinations), ${violations} violation(s)`);
if (violations) fail(`${violations} source violation(s)`);

// 2. browser
if (process.argv.includes("--source-only")) {
  console.log("--source-only: browser steps skipped");
} else {
  const chrome = await startChrome();
  console.log(`Chrome pid ${chrome.pid} on port ${chrome.port} (system Chrome, stopped by PID at the end)`);
  try {
    const tab = await Tab.open(chrome.port);
    const st = await detectorSelfTest(tab);
    await tab.close();
    console.log(`detector self-test: ${st.ok ? "ok" : "FAILED"} ${JSON.stringify({ overrideFlagged: st.overrideFlagged, overrideClearWithImportant: st.overrideClearWithImportant, shadowedFlagged: st.shadowedFlagged, shadowedClearWithImportant: st.shadowedClearWithImportant })}`);
    if (!st.ok) fail("the leak detector cannot tell a leak from no leak");
    for (const r of await runFixtureAudit(chrome.port)) {
      console.log(`fixture audit, ${r.scheme}: elements=${r.elements} legacy-declared-properties=${r.legacyProps} | OVERRIDE leaks=${r.override.length} | SHADOWED utilities=${r.shadowed.length} | BASE leaks outside the allow-list=${r.base.length} (allow-listed derived values: ${r.allowListed})`);
      for (const l of r.override.slice(0, 10)) console.error(`  override: ${l}`);
      for (const l of r.shadowed.slice(0, 10)) console.error(`  shadowed: ${l}`);
      for (const l of r.base.slice(0, 10)) console.error(`  base: ${l}`);
      if (r.override.length) fail(`${r.scheme}: ${r.override.length} override leak(s): a legacy rule beats a v2 style`);
      if (r.shadowed.length) fail(`${r.scheme}: ${r.shadowed.length} utility declaration(s) do not win the cascade`);
      if (r.base.length) fail(`${r.scheme}: ${r.base.length} base leak(s) outside the allow-list`);
    }
    console.log(`base-leak allow-list: ${BASE_ALLOW.join(", ")}`);

    if (!process.argv.includes("--fixture-only")) await pageMode(chrome);
  } finally {
    chrome.stop();
  }
}
console.log(failed ? "\nAUDIT FAILED" : "\nAUDIT PASSED");
process.exit(failed ? 1 : 0);
