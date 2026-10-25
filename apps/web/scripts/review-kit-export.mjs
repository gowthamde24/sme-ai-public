// Writes the native-review kit (job DL): per language (Telugu, Hindi, Kannada) a review sheet as CSV and as a printable page, and the one-page note for the reviewers.
//   npm run i18n:kit-export -- [--out DIR] [--lang te]      (DIR defaults to ~/Desktop/stack19-jobs/review-kit; every language unless --lang)
// What goes in a sheet: the home page texts and sample chats, the Privacy Policy, the data-deletion page, the sign-up and sign-in screens, and the 200 app strings that most screens show.
// The filled sheet comes back with `npm run i18n:kit-import`.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { KIT_LANGS, ROOT, buildRows, loadSources, noteHtml, sheetCsv, sheetHtml } from "./lib/review-kit.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = flag("out") ?? path.join(os.homedir(), "Desktop", "stack19-jobs", "review-kit");
const only = flag("lang");
if (only && !KIT_LANGS.includes(only)) {
  console.error(`--lang must be one of ${KIT_LANGS.join(", ")}`);
  process.exit(2);
}
const src = loadSources();
const date = new Date().toISOString().slice(0, 10);
for (const lang of only ? [only] : KIT_LANGS) {
  const rows = buildRows(lang, src);
  const dir = path.join(out, lang);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `review-${lang}.csv`), sheetCsv(rows));
  writeFileSync(path.join(dir, `review-${lang}.html`), sheetHtml(lang, rows, { date }));
  console.log(`${lang}: ${rows.length} texts -> ${dir}`);
}
const note = readFileSync(path.join(ROOT, "i18n/review/how-to-review.md"), "utf8");
mkdirSync(out, { recursive: true });
copyFileSync(path.join(ROOT, "i18n/review/how-to-review.md"), path.join(out, "HOW-TO-REVIEW.md"));
writeFileSync(path.join(out, "HOW-TO-REVIEW.html"), noteHtml(note));
console.log(`note -> ${path.join(out, "HOW-TO-REVIEW.md")} (and .html)`);
