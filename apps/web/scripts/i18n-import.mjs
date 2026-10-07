// Reads the owner's edited review sheet and writes it back into src/i18n/strings/*.json.
//   npm run i18n:import -- <review.csv> [--dry-run]
// A row with text in "owner-edit" replaces the string and becomes "reviewed". A row with no edit whose
// status the owner changed to "reviewed" is accepted as it is. Edits that change the {placeholders} are refused.
import { readFileSync } from "node:fs";
import { SETS, applyReviewCsv, loadSets, saveSet } from "./lib/i18n-data.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: npm run i18n:import -- <review.csv> [--dry-run]");
  process.exit(2);
}
const sets = loadSets();
const { changed, accepted, errors } = applyReviewCsv(sets, readFileSync(file, "utf8"));
for (const e of errors) console.error("  - " + e);
console.log(`${changed} string(s) replaced by the owner's edit, ${accepted} accepted as they are.`);
if (errors.length) {
  console.error(`${errors.length} row(s) were refused; nothing was written.`);
  process.exit(1);
}
if (args.includes("--dry-run")) console.log("dry run: nothing written.");
else for (const s of SETS) saveSet(s, sets[s]);
