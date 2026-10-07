// npm run audit:leaks: the CSS-leak audit for design v2 (ADR 0060). NOT part of `npm test` and NOT in CI (it needs a
// system Chrome); run it at every stage STOP. It checks, in order:
//   1. the source rules (no legacy class names, no inline style next to classes, v2 stylesheets fully scoped);
//   2. in headless Chrome: the detector's own self-test, then the fixture audit (real legacy CSS + real compiled v2 CSS
//      + the probe markup), in light and dark.
// Exit 1 if: a source rule fails, the detector cannot tell a leak from no leak, any OVERRIDE leak or SHADOWED utility
// exists, or any BASE leak is outside the allow-list. `--source-only` skips the browser steps.
import fs from "node:fs";
import path from "node:path";

import { startChrome, Tab } from "./lib/chrome.mjs";
import { BASE_ALLOW, ROOT, detectorSelfTest, runFixtureAudit } from "./lib/leak-audit.mjs";
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
  } finally {
    chrome.stop();
  }
}
console.log(failed ? "\nAUDIT FAILED" : "\nAUDIT PASSED");
process.exit(failed ? 1 : 0);
