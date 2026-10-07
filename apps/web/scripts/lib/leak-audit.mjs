// The CSS-leak audit (ADR 0060, Stage 1). It proves that the legacy stylesheet (app/globals.css, unlayered, loaded on
// every route) does not override or seep into design-v2 elements.
//
// Method, in headless Chrome: build a page from the REAL legacy CSS and the REAL compiled v2 CSS plus the probe markup,
// take the computed value of every property for every element inside [data-ui="v2"], disable the legacy sheet, take them
// again, and classify the differences:
//   OVERRIDE leak = a property the v2 sheet itself declares for that element changes: a legacy rule beats a v2 style.
//                   Must be 0.
//   BASE leak     = a property the legacy sheet declares changes on a v2 element: legacy defaults seeping in. Must be 0
//                   after the scoped reset, except the allow-list below.
//   SHADOWED      = a utility that is declared for an element but does not win the cascade (computed value differs from
//                   what the same declaration gives as an inline !important). Catches what the two checks above cannot:
//                   a v2 rule (for instance the v2 reset) beating the v2 utilities. Must be 0.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { Tab } from "./chrome.mjs";

export const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * Base-leak allow-list: used or derived values that follow from the legacy `html, body { margin: 0 }` (the browser's
 * own 8px body margin would otherwise change the width of block elements that fill the page). Nothing else is allowed.
 */
export const BASE_ALLOW = ["width", "height", "inline-size", "block-size", "perspective-origin", "transform-origin"];

/** Compiles design/v2.css (plus the probe folder) with the project's own PostCSS + Tailwind plugin. */
export async function compileV2Css(root = ROOT) {
  const req = createRequire(import.meta.url);
  const tailwind = (await import(req.resolve("@tailwindcss/postcss"))).default;
  const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
  const entry = '@import "./v2.css";\n@source "../scripts/audit";\n';
  const result = await postcss([tailwind()]).process(entry, { from: path.join(root, "design/audit-entry.css") });
  return result.css;
}

export const readLegacyCss = (root = ROOT) => fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
export const readProbe = (root = ROOT) => fs.readFileSync(path.join(root, "scripts/audit/probe.html"), "utf8");

export const buildPage = ({ legacyCss, v2Css, body }) =>
  `<!doctype html><html><head><meta charset="utf-8"><style id="legacy">${legacyCss}</style><style id="v2">${v2Css}</style></head><body>${body}</body></html>`;

/** Runs inside the page. Sheets are told apart by the id of their <style>. */
const PAGE_JS = `((allow) => {
  // Flattens a sheet's rules, remembering the cascade layer and skipping @media / @supports blocks that are not active.
  const flat = (rules, layer = '') => rules.flatMap((r) => {
    if (r.selectorText) return [{ r, layer }];
    if (!r.cssRules) return [];
    if (r.conditionText !== undefined && r.media === undefined && r.constructor.name === 'CSSSupportsRule' && !CSS.supports(r.conditionText)) return [];
    if (r.media && !window.matchMedia(r.media.mediaText).matches) return [];
    return flat([...r.cssRules], r.constructor.name === 'CSSLayerBlockRule' ? (layer ? layer + '.' : '') + r.name : layer);
  });
  const sheetOf = (id) => [...document.styleSheets].find((s) => s.ownerNode && s.ownerNode.id === id);
  const legacy = sheetOf('legacy'), v2 = sheetOf('v2');
  const legacyProps = new Set();
  for (const { r } of flat([...legacy.cssRules])) if (r.style) for (const p of r.style) if (!p.startsWith('--')) legacyProps.add(p);
  const els = [...document.querySelectorAll('#v2root, #v2root *')].filter((e) => e.id);
  const v2Rules = flat([...v2.cssRules]);
  const v2Declared = {}, lastUtility = {};
  for (const e of els) {
    v2Declared[e.id] = new Set();
    lastUtility[e.id] = {};
    for (const { r, layer } of v2Rules) {
      let hit = false;
      try { hit = e.matches(r.selectorText); } catch { hit = false; }
      if (!hit) continue;
      for (const p of r.style) {
        if (p.startsWith('--')) continue;
        v2Declared[e.id].add(p);
        if (layer === 'utilities') lastUtility[e.id][p] = r.style.getPropertyValue(p); // later rules win within the layer
      }
    }
  }
  // SHADOWED: the winning utility value must be the computed value.
  const shadowed = [];
  for (const e of els) {
    for (const [p, v] of Object.entries(lastUtility[e.id])) {
      const actual = getComputedStyle(e).getPropertyValue(p);
      e.style.setProperty(p, v, 'important');
      const expected = getComputedStyle(e).getPropertyValue(p);
      e.style.removeProperty(p);
      if (actual !== expected) shadowed.push('#' + e.id + ' ' + p + ': computed ' + actual + ' but the utility says ' + expected);
    }
  }
  const snap = () => Object.fromEntries(els.map((e) => [e.id, Object.fromEntries([...legacyProps, ...v2Declared[e.id]].map((p) => [p, getComputedStyle(e).getPropertyValue(p)]))]));
  const withLegacy = snap();
  legacy.disabled = true;
  const without = snap();
  const override = [], base = [];
  let allowListed = 0;
  for (const e of els) {
    for (const p of Object.keys(withLegacy[e.id])) {
      if (withLegacy[e.id][p] === without[e.id][p]) continue;
      const m = p.match(/^border-(top|right|bottom|left)-(color|style)$/);
      if (m && getComputedStyle(e).getPropertyValue('border-' + m[1] + '-width') === '0px') continue; // invisible border
      const rec = '#' + e.id + ' ' + p + ': ' + withLegacy[e.id][p] + ' (v2 alone: ' + without[e.id][p] + ')';
      if (v2Declared[e.id].has(p)) override.push(rec);
      else if (allow.includes(p)) allowListed++;
      else base.push(rec);
    }
  }
  return { elements: els.length, legacyProps: legacyProps.size, override, base, shadowed, allowListed };
})(__ALLOW__)`;

export async function auditPage(tab, html) {
  await tab.setHtml(html);
  return tab.eval(PAGE_JS.replace("__ALLOW__", JSON.stringify(BASE_ALLOW)));
}

/**
 * The detector's own test. It must tell apart (1) a layered, non-important utility under an unlayered legacy `button`
 * rule (an OVERRIDE leak) from the same utility with `important` (none), and (2) a layered utility under an unlayered
 * v2 reset rule (SHADOWED) from the same utility with `important` (none). If it cannot, the audit is void.
 */
export async function detectorSelfTest(tab) {
  const legacyCss = ".shell{color:red}.card{color:red}button{background:rgb(255,0,0);padding:1px 2px}";
  const body = '<div data-ui="v2" id="v2root"><button id="b" class="bg-x">x</button></div>';
  const page = (v2Css) => buildPage({ legacyCss, v2Css, body });
  const weak = await auditPage(tab, page("@layer utilities{[data-ui=v2] .bg-x{background:rgb(0,0,255)}}"));
  const strong = await auditPage(tab, page("@layer utilities{[data-ui=v2] .bg-x{background:rgb(0,0,255)!important}}"));
  const resetWins = await auditPage(tab, page("[data-ui=v2] button{background:rgb(1,2,3)} @layer utilities{[data-ui=v2] .bg-x{background:rgb(0,0,255)}}"));
  const resetLoses = await auditPage(tab, page("[data-ui=v2] button{background:rgb(1,2,3)} @layer utilities{[data-ui=v2] .bg-x{background:rgb(0,0,255)!important}}"));
  const checks = {
    overrideFlagged: weak.override.length >= 1,
    overrideClearWithImportant: strong.override.length === 0 && strong.shadowed.length === 0,
    shadowedFlagged: resetWins.shadowed.length >= 1,
    shadowedClearWithImportant: resetLoses.shadowed.length === 0,
  };
  return { ...checks, ok: Object.values(checks).every(Boolean) };
}

/** Runs the fixture audit in light and dark. Returns one result per colour scheme. */
export async function runFixtureAudit(chromePort, root = ROOT) {
  const page = buildPage({ legacyCss: readLegacyCss(root), v2Css: await compileV2Css(root), body: readProbe(root) });
  const out = [];
  for (const dark of [false, true]) {
    const tab = await Tab.open(chromePort, { dark });
    try {
      out.push({ scheme: dark ? "dark" : "light", ...(await auditPage(tab, page)) });
    } finally {
      await tab.close();
    }
  }
  return out;
}
