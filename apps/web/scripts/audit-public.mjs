// npm run audit:public -- <base-url> [--screens dir]: the launch public pages (pricing, help and its articles, status, acceptable use, refunds, Talk to us, an industry page) on a RUNNING server (next dev or next start; not started
// here). In the system Chrome, at 360, 390, 412 and 1440 px, light and dark, in English and Telugu: no horizontal scroll, no element outside the screen, no text on text, no console error; optional screenshots.
// NOT part of `npm test` and NOT in CI (it needs a browser). Exit 1 on any failure; the numbers are printed.
import fs from "node:fs";
import path from "node:path";

import { startChrome } from "./lib/chrome.mjs";
import { Tab } from "./lib/chrome.mjs";
import { LAYOUT, OVERLAP } from "./lib/page-checks.mjs";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const shots = process.argv.includes("--screens") ? process.argv[process.argv.indexOf("--screens") + 1] : null;
const PAGES = ["/pricing", "/help", "/help/set-up-your-assistant", "/status", "/acceptable-use", "/refunds", "/talk-to-us", "/for/kirana"];
const LANGS = ["en", "te"];
const WIDTHS = [360, 390, 412, 1440];

const chrome = await startChrome(Number(process.env.DEBUG_PORT ?? 9339), { hideScrollbars: true });
const problems = [];
let n = 0;
try {
  for (const lang of LANGS) for (const dark of [false, true]) for (const width of WIDTHS) {
    const tab = await Tab.open(chrome.port, { width, height: 900, dark, mobile: width < 600 });
    try {
      for (const p of PAGES) {
        const url = `${base}${lang === "en" || p.startsWith("/for/") ? "" : `/${lang}`}${p}`;
        await tab.goto(url, 700);
        const lay = await tab.eval(LAYOUT);
        n++;
        const where = `${url} ${width}px ${dark ? "dark" : "light"}`;
        if (lay.docScrollWidth > lay.viewportW + 1) problems.push(`${where}: scrolls sideways (${lay.docScrollWidth} > ${lay.viewportW})`);
        for (const o of lay.offenders) problems.push(`${where}: outside the screen: ${o}`);
        if (width <= 768) for (const o of await tab.eval(OVERLAP)) problems.push(`${where}: text on text: ${o}`);
        if (shots && lang === "en" && (width === 390 || width === 1440)) {
          fs.mkdirSync(shots, { recursive: true });
          const { data } = await tab.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
          fs.writeFileSync(path.join(shots, `${p.replace(/\//g, "_").slice(1)}-${width}-${dark ? "dark" : "light"}.png`), Buffer.from(data, "base64"));
        }
      }
      for (const l of tab.logs.filter((x) => !/favicon|Download the React DevTools|Fast Refresh|\[HMR\]/.test(x))) problems.push(`${width}px ${dark ? "dark" : "light"} ${lang}: ${l}`);
    } finally {
      await tab.close();
    }
  }
} finally {
  await chrome.stop();
}
console.log(`${n} page views checked`);
for (const p of problems) console.log("FAIL", p);
process.exit(problems.length ? 1 : 0);
