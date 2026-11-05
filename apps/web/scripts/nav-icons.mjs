// The menu's line icons as ONE static SVG sprite (sidebar v2): public/icons/nav.svg, a <symbol> per icon, drawn by components/v2/app/icons.tsx with <use>. The icons are lucide's own shapes (ISC licence, lucide-react in
// package.json), copied at build-time, so they cost the pages' JavaScript nothing (the route-JS budget, scripts/audit-route-js.mjs): the browser fetches the sprite once and keeps it.
//
//   node scripts/nav-icons.mjs          write public/icons/nav.svg and print its version (put it in SPRITE_VERSION in components/v2/app/icons.tsx)
//   node scripts/nav-icons.mjs --check  exit 1 when the committed sprite is not what the list below makes (the unit test runs the same check)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..");
export const SPRITE = path.join(WEB, "public", "icons", "nav.svg");

/** Every icon the sprite holds (lucide names). */
export const NAMES = [
  "calendar-days", "mic", "inbox", "search", "phone", "message-square", "history", "map-pin", "package", "images", "file-text", "shopping-cart", "truck", "indian-rupee", "clipboard-list", "graduation-cap", "megaphone",
  "chart-column", "users", "pen-line", "smartphone", "link-2", "settings", "send", "building-2", "armchair", "plug", "store", "users-round", "tags",
  // the frame's own buttons
  "chevron-down", "menu", "circle-help", "panel-left-close", "panel-left-open", "log-out", "x",
];

const attr = (k, v) => `${k === "key" ? "" : ` ${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${String(v).replace(/"/g, "&quot;")}"`}`;

export async function build() {
  const symbols = [];
  for (const name of NAMES) {
    const dir = path.join(WEB, "node_modules", "lucide-react", "dist", "esm", "icons");
    let file = path.join(dir, `${name}.mjs`);
    // an old name is an alias of the new one (`export { default } from './rotate-ccw-clock.mjs'`): follow it
    const alias = /export \{ default \} from '\.\/([a-z0-9-]+)\.mjs'/.exec(readFileSync(file, "utf8"));
    if (alias) file = path.join(dir, `${alias[1]}.mjs`);
    const { __iconData } = await import(pathToFileURL(file).href);
    if (!__iconData?.node) throw new Error(`lucide has no icon ${name}`);
    const inner = __iconData.node.map(([tag, a]) => `<${tag}${Object.entries(a).map(([k, v]) => attr(k, v)).join("")}/>`).join("");
    symbols.push(`<symbol id="${name}" viewBox="0 0 24 24">${inner}</symbol>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg"><!-- lucide icons (ISC licence), made by scripts/nav-icons.mjs; do not edit by hand -->${symbols.join("")}</svg>\n`;
}
export const versionOf = (text) => createHash("sha256").update(text).digest("hex").slice(0, 10);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const text = await build();
  if (process.argv.includes("--check")) {
    const now = readFileSync(SPRITE, "utf8");
    if (now !== text) {
      console.error("public/icons/nav.svg is out of date: run node scripts/nav-icons.mjs");
      process.exit(1);
    }
    console.log(`nav icons ok (${versionOf(text)})`);
  } else {
    writeFileSync(SPRITE, text);
    console.log(`wrote ${path.relative(WEB, SPRITE)} (${NAMES.length} icons, ${text.length} bytes), version ${versionOf(text)}`);
  }
}
