// npm run audit:budget: the JS budget for the public landing page (ADR 0060 decision 5, scripts/budget.json).
// Starts `next start` (run `npm run build` first), fetches the route, gzips every <script src> it references (the way
// scripts/spike measured the baseline: level 9) and compares the total with baseline + allowance. Exit 1 if over.
// It also prints, informationally, the font bytes a visitor of each language actually downloads (Chrome's resource
// timing, light theme, 1440 px) and the total CSS. No dependency: Node's fetch and zlib, and the system Chrome.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { startChrome, Tab } from "./lib/chrome.mjs";
import { ROOT } from "./lib/leak-audit.mjs";
import { LANGS, startNext } from "./lib/next-server.mjs";

const budget = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/budget.json"), "utf8"));
const limit = budget.baselineGzipBytes + budget.allowanceGzipBytes;
const fmt = (n) => n.toLocaleString("en-US");

const app = await startNext();
console.log(`next start pid ${app.pid} on ${app.base} (stopped by PID at the end)`);
let failed = false;
let chrome;
try {
  const html = await (await fetch(`${app.base}${budget.route}`)).text();
  const srcs = [...new Set([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]))];
  let raw = 0;
  let gz = 0;
  const rows = [];
  for (const src of srcs) {
    const body = Buffer.from(await (await fetch(new URL(src, app.base))).arrayBuffer());
    const g = zlib.gzipSync(body, { level: 9 }).length;
    raw += body.length;
    gz += g;
    rows.push([g, body.length, src.split("?")[0]]);
  }
  rows.sort((a, b) => b[0] - a[0]);
  for (const [g, r, s] of rows.slice(0, 8)) console.log(`  ${fmt(g).padStart(8)} B gzip  ${fmt(r).padStart(9)} B raw  ${s}`);
  if (rows.length > 8) console.log(`  ... and ${rows.length - 8} more script file(s)`);
  const css = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  let cssGz = 0;
  for (const href of css) cssGz += zlib.gzipSync(Buffer.from(await (await fetch(new URL(href, app.base))).arrayBuffer()), { level: 9 }).length;
  console.log(`route ${budget.route}: ${srcs.length} script file(s), ${fmt(raw)} B raw, ${fmt(gz)} B gzip; ${css.length} stylesheet(s), ${fmt(cssGz)} B gzip (informational)`);
  const margin = limit - gz;
  console.log(`JS budget: baseline ${fmt(budget.baselineGzipBytes)} + allowance ${fmt(budget.allowanceGzipBytes)} = ${fmt(limit)} B gzip; total ${fmt(gz)} B; ${margin >= 0 ? "margin" : "OVER by"} ${fmt(Math.abs(margin))} B (${(100 * gz / limit).toFixed(1)}% of the limit; the page itself adds ${fmt(gz - budget.baselineGzipBytes)} B over the empty route)`);
  if (margin < 0) {
    failed = true;
    console.error("FAIL  the landing page is over the JS budget");
  }

  chrome = await startChrome();
  for (const lang of LANGS) {
    const tab = await Tab.open(chrome.port, { width: 1440, height: 900 });
    try {
      await tab.setCookie(app.base, "sme_lang", lang);
      await tab.goto(`${app.base}${budget.route}`, 1200);
      const fonts = await tab.eval(`performance.getEntriesByType('resource').filter((e) => /\\.(woff2?|ttf|otf)(\\?|$)/.test(e.name)).map((e) => [e.name.split('/').pop(), e.encodedBodySize])`);
      const total = fonts.reduce((a, [, n]) => a + n, 0);
      console.log(`fonts a ${lang} visitor downloads (informational): ${fonts.length} file(s), ${fmt(total)} B`);
    } finally {
      await tab.close();
    }
  }
} finally {
  chrome?.stop();
  app.stop();
}
console.log(failed ? "\nBUDGET FAILED" : "\nBUDGET PASSED");
process.exit(failed ? 1 : 0);
