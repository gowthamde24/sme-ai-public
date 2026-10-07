// Writes the review sheet: every Telugu, Hindi and Kannada string, one row each, for the owner to edit.
//   npm run i18n:export -- [out.csv]                (default: ~/Desktop/i18n-review.csv, every string)
//   npm run i18n:export -- --first-pass [out.csv]   (default: ~/Desktop/i18n-first-pass.csv: only what a visitor
//                                                    sees on the landing and sign-in pages, 3 languages side by side)
// "current text" is the text before the register change if i18n/review/previous-strings.json has it,
// otherwise the live text. The owner types fixes into "owner-edit" and may set status to "reviewed".
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReviewCsv, loadPrevious, loadSets } from "./lib/i18n-data.mjs";

const args = process.argv.slice(2);
const firstPass = args.includes("--first-pass");
const out = args.find((a) => !a.startsWith("--")) ?? path.join(os.homedir(), "Desktop", firstPass ? "i18n-first-pass.csv" : "i18n-review.csv");
const csv = buildReviewCsv(loadSets(), loadPrevious(), { firstPass });
writeFileSync(out, csv);
console.log(`wrote ${out} (${csv.split("\r\n").length - 2} rows)`);
