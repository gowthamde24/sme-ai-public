/**
 * The corner rules of the web app (owner, 26 Nov 2026, measured from Meta's console): panels and cards 8 px, buttons / inputs / menus / chips 6 px, tags 4 px; ROUND only avatars, status dots, the voice orb, switches, icon circles and thin bars.
 * The Tailwind theme (design/v2.css) maps rounded-xl/2xl/3xl to 8 px and rounded-md/lg to 6 px. This module finds the class groups that break the rule; `design/radius.test.ts` fails on them and `scripts/radius-fix.mjs` rewrites them.
 * A "group" is the run of class names between two quote marks (or `${`), so one element's classes are looked at together.
 */
export const GROUP = /[^"'`{}]*\brounded[\w:-]*(?:\[[^\]]*\])?[^"'`{}]*/g;

const dims = (g, prefix) => [...g.matchAll(new RegExp(`(?:^|\\s)(?:[\\w:-]+:)?${prefix}-(\\[[^\\]]+\\]|[\\d.]+)(?=\\s|$)`, "g"))].map((m) => m[1]);
/** A round shape that is meant to be round: a square box (an avatar, a dot, an icon circle, a knob), a spinner, or a bar with no text padding. */
export function isRoundShape(g) {
  if (/(?:^|\s)(?:[\w:-]+:)?size-/.test(g) || /\baspect-square\b/.test(g) || /\banimate-(spin|pulse)\b/.test(g)) return true;
  const w = dims(g, "w"), h = dims(g, "h");
  if (w.some((x) => h.includes(x))) return true;
  const mw = dims(g, "min-w"), mh = dims(g, "min-h");
  if (mw.some((x) => mh.includes(x)) && !/(?:^|\s)px-/.test(g)) return true;
  return false;
}
const TEXT_PAD = /(?:^|\s)(?:[\w:-]+:)?p[xlr]-/;
const INTERACTIVE = /(?:^|\s)(?:hover|focus-visible|focus|disabled|active|group-hover):/;
const heightOf = (g) => { const h = dims(g, "h").map((x) => (x.startsWith("[") ? Number.parseFloat(x.slice(1)) / 4 : Number(x))); return h.length ? Math.min(...h) : null; };
/** Problems of one class group: the names that must change, with what to use. A group with the class `round-ok` is on purpose round or soft: the voice orb, a switch, a count badge, and PHONE MOCK-UPS (the device frame, chat bubbles and avatars inside a picture of a phone), which must look like a real phone. */
export function problems(g) {
  const out = [];
  if (/(?:^|\s)round-ok(?=\s|$)/.test(g)) return out;
  for (const m of g.matchAll(/(?:^|\s)((?:[\w:-]+:)?)rounded(-(?:[trblse]{1,2}))?-(2xl|3xl|4xl|\[(\d+(?:\.\d+)?)(px|rem)\])(?=\s|$)/g)) {
    const px = m[4] ? (m[5] === "rem" ? Number(m[4]) * 16 : Number(m[4])) : 99;
    if (px > 8) out.push({ kind: "big", token: `${m[1]}rounded${m[2] ?? ""}-${m[3]}`, to: `${m[1]}rounded${m[2] ?? ""}-xl` });
  }
  for (const m of g.matchAll(/(?:^|\s)((?:[\w:-]+:)?rounded(?:-[trblse]{1,2})?-\[)([^\]]*_[^\]]*)\]/g)) {
    const to = m[2].replace(/(\d+(?:\.\d+)?)px/g, (x, n) => (Number(n) > 8 ? "8px" : x));
    if (to !== m[2]) out.push({ kind: "big", token: `${m[1]}${m[2]}]`, to: `${m[1]}${to}]` });
  }
  if (/(?:^|\s)(?:[\w:-]+:)?rounded-full(?=\s|$)/.test(g)) {
    const small = /(?:^|\s)px-(?:1|1\.5|2|2\.5)(?=\s)/.test(g) && /\btext-(?:xs|\[1[0-3](?:\.5)?px\])/.test(g);
    const to = small ? "rounded" : "rounded-md";
    const h = heightOf(g);
    if (TEXT_PAD.test(g) && !isRoundShape(g)) out.push({ kind: "pill", token: "rounded-full", to });
    else if (INTERACTIVE.test(g) && !(h !== null && h <= 7 && /(?:^|\s)w-/.test(g))) out.push({ kind: "icon-button", token: "rounded-full", to });
    else if (!isRoundShape(g) && !(h !== null && h <= 7) && /(?:^|\s)(?:border|bg-|shadow)/.test(g) && /(?:^|\s)(?:inline-flex|flex|grid)(?=\s)/.test(g)) out.push({ kind: "chip", token: "rounded-full", to });
  }
  return out;
}
