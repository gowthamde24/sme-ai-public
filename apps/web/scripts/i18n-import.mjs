// Reads the owner's edited review sheet and writes it back into src/i18n/strings/*.json.
//   npm run i18n:import -- <review.csv> [--dry-run] [--blank-is-approved] [--drafts]
// A row with text in "owner-edit" replaces the string and becomes "reviewed". A row with no edit whose
// status the owner changed to "reviewed" is accepted as it is. With --blank-is-approved (a sheet that says "empty = approved", like the Customer Zero week-one sheet) a row left empty is accepted as reviewed too. Edits that change the {placeholders} are refused.
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { SETS, applyOwnerSheet, applyReviewCsv, isOwnerSheet, loadSets, saveSet } from "./lib/i18n-data.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: npm run i18n:import -- <review.csv> [--dry-run] [--blank-is-approved] [--drafts]");
  process.exit(2);
}
const sets = loadSets();
if (isOwnerSheet(readFileSync(file, "utf8"))) {
  // the owner's Customer Zero sheet: `--drafts` writes the proposed Telugu as drafts (nothing reviewed); otherwise it is his returned sheet and what he approved becomes reviewed
  const mode = args.includes("--drafts") ? "drafts" : "approve";
  const packFile = path.join(import.meta.dirname, "../i18n/review/pack-labels-reviewed.json");
  let packReviewed = { te: {}, hi: {}, kn: {} };
  try {
    packReviewed = JSON.parse(readFileSync(packFile, "utf8")); // (read, not "exists then read": the file may change in between)
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
  }
  const r = applyOwnerSheet(sets, readFileSync(file, "utf8"), { mode, packReviewed });
  for (const e of r.errors) console.error("  - " + e);
  if (mode === "drafts") console.log(`${r.written} Telugu draft(s) written (still drafts); ${r.skippedHumanOnly.length} consent / money / legal line(s) skipped (they stay English until he approves them).`);
  else console.log(`${r.approved} string(s) reviewed (${r.edited} with his own text); ${r.packApproved} pack word(s); ${r.skipped.length} skipped row(s) ignored; ${r.pending.length} line(s) still waiting for his "ok" or an edit${r.pending.length ? ": " + r.pending.join(", ") : ""}; ${r.refused.length} refused by him${r.refused.length ? ": " + r.refused.join(", ") : ""}.`);
  if (r.errors.length) {
    console.error(`${r.errors.length} row(s) were refused; nothing was written.`);
    process.exit(1);
  }
  if (args.includes("--dry-run")) console.log("dry run: nothing written.");
  else {
    for (const s of SETS) saveSet(s, sets[s]);
    if (r.packApproved) writeFileSync(packFile, JSON.stringify(packReviewed, null, 2) + "\n");
  }
  process.exit(0);
}
const { changed, accepted, errors } = applyReviewCsv(sets, readFileSync(file, "utf8"), { blankApproves: args.includes("--blank-is-approved") });
for (const e of errors) console.error("  - " + e);
console.log(`${changed} string(s) replaced by the owner's edit, ${accepted} accepted as they are.`);
if (errors.length) {
  console.error(`${errors.length} row(s) were refused; nothing was written.`);
  process.exit(1);
}
if (args.includes("--dry-run")) console.log("dry run: nothing written.");
else for (const s of SETS) saveSet(s, sets[s]);
