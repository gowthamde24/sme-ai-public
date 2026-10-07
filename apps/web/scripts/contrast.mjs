// npm run audit:contrast: WCAG contrast of the design-v2 tokens (design/tokens.css), light and dark.
// Text >= 4.5:1, large text and UI >= 3:1, muted text >= 5:1. Exits 1 on any violation or if the two dark blocks differ.
import fs from "node:fs";
import path from "node:path";

import { runContrast } from "./lib/contrast.mjs";

const css = fs.readFileSync(path.resolve(import.meta.dirname, "../design/tokens.css"), "utf8");
const { rows, failures, total, mediaMatchesDark } = runContrast(css);
let mode = "";
for (const r of rows) {
  if (r.mode !== mode) console.log(`\n${(mode = r.mode)}`);
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.ratio.toFixed(2).padStart(5)}:1  (>= ${r.min})  ${r.label}  [${r.fg} on ${r.bg}]`);
}
console.log(`\n${total - failures}/${total} checks passed (${total / 2} per mode).`);
console.log(`dark tokens in the attribute block and the media-query block are ${mediaMatchesDark ? "identical" : "DIFFERENT"}.`);
if (failures || !mediaMatchesDark) {
  console.error(`FAILED: ${failures} contrast violation(s)${mediaMatchesDark ? "" : " and the dark blocks differ"}.`);
  process.exit(1);
}
