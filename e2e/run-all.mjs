// Runs everything in order and prints a one-line verdict per step. Usage: npm run all
import { spawnSync } from "node:child_process";
const steps = [
  ["setup-local-users.mjs"],
  ["agents.mjs"],
  ["review.mjs", "desktop", "labeler1"],
  ["export.mjs"],
  ["review.mjs", "phone", "labeler2"],
];
let failed = false;
for (const [file, ...args] of steps) {
  console.log(`\n=== node ${file} ${args.join(" ")}`);
  const r = spawnSync("node", [file, ...args], { stdio: "inherit" });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
