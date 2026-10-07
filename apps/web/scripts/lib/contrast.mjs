// WCAG 2.1 contrast audit helpers for the ONE orange theme (design/tokens.css), light and dark. Pure functions:
// scripts/contrast.mjs prints the result, contrast.test.ts runs it under vitest. No dependency.
const TOKEN = /--v2-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g;

function readBlock(css, selectorRegex, label) {
  const m = css.match(selectorRegex);
  if (!m) throw new Error(`token block not found: ${label}`);
  const tokens = {};
  for (const t of m[1].matchAll(TOKEN)) tokens[t[1]] = t[2].toLowerCase();
  return tokens;
}

/** { light, dark, mediaDark } colour tokens, names without the --v2- prefix. */
export function readTokens(css) {
  const light = readBlock(css, /\[data-ui="v2"\]\s*\{([^}]*)\}/, 'light block [data-ui="v2"]');
  const darkOnly = readBlock(css, /\[data-ui="v2"\]\[data-theme="dark"\]\s*\{([^}]*)\}/, "dark attribute block");
  const mediaOnly = readBlock(css, /\[data-ui="v2"\]:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/, "dark media block");
  return { light, dark: { ...light, ...darkOnly }, darkOnly, mediaOnly };
}

const lin = (c) => {
  const n = c / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
export const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [label, foreground token, background token, minimum]
export const CHECKS = [
  ["ink on page", "ink", "bg", 4.5],
  ["ink on surface", "ink", "surface", 4.5],
  ["ink on surface-2", "ink", "surface-2", 4.5],
  ["muted on page", "muted", "bg", 5],
  ["muted on surface", "muted", "surface", 5],
  ["muted on surface-2", "muted", "surface-2", 4.5],
  ["orange text/link on page", "brand-text", "bg", 4.5],
  ["orange text/link on surface", "brand-text", "surface", 4.5],
  ["orange text/link on orange tint", "brand-text", "brand-bg", 4.5],
  ["primary button: dark ink on orange", "on-brand", "brand", 4.5],
  ["secondary button: text on charcoal", "on-charcoal", "charcoal", 4.5],
  ["info text on info tint", "info-text", "info-bg", 4.5],
  ["info text on surface", "info-text", "surface", 4.5],
  ["green text on green tint", "green-text", "green-bg", 4.5],
  ["green text on surface", "green-text", "surface", 4.5],
  ["amber text on amber tint", "amber-text", "amber-bg", 4.5],
  ["amber text on surface", "amber-text", "surface", 4.5],
  ["red text on red tint", "red-text", "red-bg", 4.5],
  ["red text on surface", "red-text", "surface", 4.5],
  ["focus ring on page", "ring", "bg", 3],
  ["focus ring on surface", "ring", "surface", 3],
  ["control edge on page", "border-strong", "bg", 3],
  ["control edge on surface", "border-strong", "surface", 3],
  ["primary button edge on page", "brand-edge", "bg", 3],
  ["primary button edge on surface", "brand-edge", "surface", 3],
  ["meter / progress fill on surface-2 track", "brand-text", "surface-2", 3],
];

/** Runs every check in both modes. Returns { rows, failures, total, mediaMatchesDark }. */
export function runContrast(css) {
  const { light, dark, darkOnly, mediaOnly } = readTokens(css);
  const rows = [];
  for (const [mode, tokens] of [["LIGHT", light], ["DARK", dark]]) {
    for (const [label, fg, bg, min] of CHECKS) {
      const r = ratio(tokens[fg], tokens[bg]);
      rows.push({ mode, label, fg: tokens[fg], bg: tokens[bg], ratio: r, min, ok: r >= min });
    }
  }
  const mediaMatchesDark = JSON.stringify(Object.entries(darkOnly).sort()) === JSON.stringify(Object.entries(mediaOnly).sort());
  return { rows, failures: rows.filter((r) => !r.ok).length, total: rows.length, mediaMatchesDark };
}
