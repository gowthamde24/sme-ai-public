// The "no three.js anywhere" rule (job CJ: the Office is a plain plush room now; three, react-three-fiber and drei left the app). Pure file reads, no build needed for the source part.
import fs from "node:fs";
import path from "node:path";

const SKIP = new Set(["node_modules", ".next", ".git", "coverage", "test-results", "out"]);
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (SKIP.has(e.name) ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)])) : []);

/** An import or require of three, three/..., @react-three/..., or @types/three, in the way code names a module (a string after from / import( / require( ). */
export const THREE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["'](?:three(?:\/[^"']*)?|@react-three\/[^"']+|@types\/three)["']/;
const THREE_DEP = /^(three|@react-three\/.+|@types\/three)$/;

/**
 * Every place three.js is still named under `root` (the apps/web folder): an import in a source file, a dependency in package.json, a package in package-lock.json's root entry or its node_modules/three, and an
 * `office3d` budget. Returns a list of sentences; empty means the app is free of it. This very rule file and its test are not searched (they must name what they forbid).
 */
export function findThree(root, { skip = [] } = {}) {
  const found = [];
  const own = new Set(["scripts/lib/no-three.mjs", "scripts/lib/no-three.test.ts", "scripts/audit-3d.mjs", ...skip]);
  for (const f of walk(root)) {
    const rel = path.relative(root, f).split(path.sep).join("/");
    if (own.has(rel)) continue;
    if (/\.(ts|tsx|mjs|js|jsx|cjs|mts)$/.test(f) && THREE_IMPORT.test(fs.readFileSync(f, "utf8"))) found.push(`${rel} imports three.js`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const sect of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) for (const name of Object.keys(pkg[sect] ?? {})) if (THREE_DEP.test(name)) found.push(`package.json ${sect} still has ${name}`);
  const lockPath = path.join(root, "package-lock.json");
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    for (const key of Object.keys(lock.packages ?? {})) if (/(^|\/)node_modules\/(three|@react-three\/[^/]+|@types\/three)$/.test(key)) found.push(`package-lock.json still locks ${key}`);
  }
  const budget = JSON.parse(fs.readFileSync(path.join(root, "scripts/budget.json"), "utf8"));
  if ("office3d" in budget || "agentOwl" in budget) found.push("scripts/budget.json still has an office3d or agentOwl budget");
  return found;
}

/** The built client chunks that carry three's core (it tags itself `__THREE__`). Empty when there is no build. */
export function threeChunks(nextDir) {
  return walk(path.join(nextDir, "static/chunks")).filter((f) => f.endsWith(".js") && fs.readFileSync(f, "utf8").includes("__THREE__"));
}
