// npm run audit:3d: three.js must be nowhere in the app (job CJ: the Office is a plain plush room, plain DOM and CSS; three, @react-three/fiber, @react-three/drei and @types/three were removed). It fails if
//   1. any source file imports three, three/..., @react-three/... or @types/three;
//   2. package.json (or package-lock.json) still lists one of them, or scripts/budget.json still has an `office3d` / `agentOwl` budget;
//   3. (after `npm run build`, when a build is there) any built client chunk carries three's core (`__THREE__`).
// No dependency: Node's fs. It reads files only; it starts nothing. Exit 1 on any violation.
import path from "node:path";

import { findThree, threeChunks } from "./lib/no-three.mjs";

const WEB = path.resolve(import.meta.dirname, "..");
const found = findThree(WEB);
const chunks = threeChunks(path.join(WEB, ".next"));
for (const f of found) console.error(`FAIL  ${f}`);
for (const c of chunks) console.error(`FAIL  the built chunk ${path.basename(c)} carries three.js`);
if (found.length || chunks.length) process.exit(1);
console.log("OK  three.js is nowhere: no import, no dependency, no budget line" + (chunks.length === 0 ? ", no built chunk carries it" : ""));
