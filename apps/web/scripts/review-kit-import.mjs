// Takes a filled review sheet back (job DL), checks it and writes the corrections into the string files and the two legal texts, marking each corrected text "reviewed".
//   npm run i18n:kit-import -- --lang te <filled.csv> [--dry-run] [--mark-unchanged-reviewed] [--allow-stale]
// Nothing is written unless the WHOLE sheet passes: {tokens} kept, no empty or space-only corrections, no bookish word, no claim we cannot prove, the "current draft" still the text in the repository.
// --mark-unchanged-reviewed: a row with nothing in "corrected" is also marked reviewed (use it when the reviewer has read the whole sheet and left only the wrong texts changed).
import { readFileSync } from "node:fs";

import { KIT_LANGS, applyPlan, loadSources, planImport } from "./lib/review-kit.mjs";

const args = process.argv.slice(2);
const li = args.indexOf("--lang");
const lang = li >= 0 ? args[li + 1] : undefined;
const file = args.filter((a, i) => !a.startsWith("--") && i !== li + 1)[0];
if (!lang || !KIT_LANGS.includes(lang) || !file) {
  console.error("usage: npm run i18n:kit-import -- --lang te|hi|kn <filled.csv> [--dry-run] [--mark-unchanged-reviewed] [--allow-stale]");
  process.exit(2);
}
const src = loadSources();
const plan = planImport(lang, src, readFileSync(file, "utf8"), { markUnchanged: args.includes("--mark-unchanged-reviewed"), allowStale: args.includes("--allow-stale") });
for (const w of plan.warnings) console.warn(`  note: ${w}`);
if (plan.errors.length) {
  for (const e of plan.errors) console.error(`  - ${e}`);
  console.error(`${plan.errors.length} problem(s) in the sheet; nothing was written.`);
  process.exit(1);
}
console.log(`${plan.stats.corrected} text(s) corrected${plan.stats.unchangedReviewed ? `, ${plan.stats.unchangedReviewed} left as they are and marked reviewed` : ""}.`);
if (plan.comments.length) {
  console.log(`${plan.comments.length} comment(s) from the reviewer (read them; nothing is done with them automatically):`);
  for (const c of plan.comments) console.log(`  ${c.key}: ${c.comment}`);
}
if (args.includes("--dry-run")) console.log("dry run: nothing written.");
else console.log(`written: ${applyPlan(lang, src, plan).join(", ") || "nothing (no corrections)"}`);
