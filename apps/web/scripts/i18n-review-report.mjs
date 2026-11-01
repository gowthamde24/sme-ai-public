// DEV ONLY: lists the strings that still need a human review (status "draft" in the translation files: machine-written, not yet read by a person who speaks the language), per language.
// Nothing about this shows in the app (owner decision, 1 Nov): no banner, no footnote, no tooltip. The flag lives in i18n/strings/*.json; this report is how it is read.
//   npm run i18n:review-report                      a summary per language (counts per file)
//   npm run i18n:review-report -- --lang te         the list of one language on the screen (key, English, current text)
//   npm run i18n:review-report -- --out report.json the full list of every language as JSON (needs_human_review: true on each row)
// It never fails the build; `npm run i18n:status` is the one that can (PUBLIC_LAUNCH_REQUIRES_REVIEWED).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { LANGS, LANG_NAMES, STRINGS_DIR } from "./lib/i18n-data.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const only = arg("lang");
const out = arg("out");
if (only && !LANGS.includes(only)) {
  console.error(`--lang must be one of ${LANGS.join(", ")}`);
  process.exit(2);
}
// every string file, the legal texts included (they are not in the review kit's sets)
const files = readdirSync(STRINGS_DIR).filter((f) => f.endsWith(".json"));
const rows = [];
for (const file of files) {
  const data = JSON.parse(readFileSync(path.join(STRINGS_DIR, file), "utf8"));
  for (const [key, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== "object" || !entry.status) continue;
    for (const lang of LANGS) {
      if (Array.isArray(entry.only) && !entry.only.includes(lang)) continue;
      if (entry.status[lang] === "draft") rows.push({ file, key, lang, needs_human_review: true, human_only: entry.humanOnly === true, en: entry.en, text: entry[lang] });
    }
  }
}
if (out) {
  writeFileSync(out, JSON.stringify(rows, null, 1) + "\n");
  console.log(`${rows.length} strings need a human review: written to ${out}`);
} else if (only) {
  for (const r of rows.filter((x) => x.lang === only)) console.log(`${r.file}\t${r.key}\t${r.en.replace(/\s+/g, " ").slice(0, 70)}\t${r.text.replace(/\s+/g, " ").slice(0, 70)}`);
} else {
  console.log("strings that still need a human review (status draft), per language and file:");
  for (const lang of LANGS) {
    const mine = rows.filter((r) => r.lang === lang);
    const per = files.map((f) => `${f.replace(".json", "")} ${mine.filter((r) => r.file === f).length}`).join(", ");
    console.log(`  ${LANG_NAMES[lang].padEnd(8)} ${String(mine.length).padStart(5)}  (${per})`);
  }
}
