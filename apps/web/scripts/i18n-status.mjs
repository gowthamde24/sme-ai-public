// Prints how many Telugu, Hindi and Kannada strings are still "draft" (machine-written, waiting for the
// owner). It never fails by default. If PUBLIC_LAUNCH_REQUIRES_REVIEWED is set (to anything but ""/0/false)
// and any string is still a draft, it exits 1, so a public build cannot go out unreviewed.
import { LANGS, LANG_NAMES, countStatus, loadSets, validate } from "./lib/i18n-data.mjs";

const sets = loadSets();
const problems = validate(sets);
if (problems.length) {
  console.error(`i18n: ${problems.length} problem(s) in src/i18n/strings:`);
  for (const p of problems.slice(0, 20)) console.error("  - " + p);
  process.exit(1);
}
const counts = countStatus(sets);
console.log("i18n review status (draft = machine-written, owner has not confirmed it yet):");
let drafts = 0;
for (const l of LANGS) {
  const c = counts[l];
  drafts += c.draft;
  console.log(`  ${LANG_NAMES[l].padEnd(8)} ${String(c.draft).padStart(5)} draft, ${String(c.reviewed).padStart(5)} reviewed, ${String(c.total).padStart(5)} total`);
}
const flag = (process.env.PUBLIC_LAUNCH_REQUIRES_REVIEWED ?? "").trim().toLowerCase();
const required = flag !== "" && flag !== "0" && flag !== "false";
if (required && drafts > 0) {
  console.error(`i18n: PUBLIC_LAUNCH_REQUIRES_REVIEWED is set and ${drafts} string(s) are still draft. Fix: import the owner's review (npm run i18n:import -- <csv>).`);
  process.exit(1);
}
if (!required) console.log("  (PUBLIC_LAUNCH_REQUIRES_REVIEWED is not set, so drafts do not fail the build.)");
