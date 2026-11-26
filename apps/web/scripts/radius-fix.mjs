// One-off rewrite of the corner rules (see radius-rules.mjs). Usage: node scripts/radius-fix.mjs [--dry]
import fs from "node:fs";
import path from "node:path";

import { GROUP, problems } from "./radius-rules.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const dry = process.argv.includes("--dry");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
let files = 0, edits = 0;
const kinds = {};
for (const dir of ["app", "components"]) for (const f of walk(path.join(ROOT, dir))) {
  if (!/\.(tsx|ts)$/.test(f) || /\.test\.|\.d\.ts$/.test(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  const out = src.replace(GROUP, (g) => {
    let next = g;
    for (const p of problems(g)) {
      next = next.replace(new RegExp(`(^|\\s)${p.token.replace(/[[\].*+?^${}()|\\]/g, "\\$&")}(?=\\s|$)`), `$1${p.to}`);
      kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
      edits++;
    }
    return next;
  });
  if (out !== src) { files++; if (!dry) fs.writeFileSync(f, out); }
}
console.log({ files, edits, kinds, dry });
