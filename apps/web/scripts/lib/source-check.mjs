// The source half of the leak audit (ADR 0060): rules that keep design-v2 code isolated from the legacy stylesheet.
//   1. v2 code never uses a class name the legacy stylesheet defines (.card, .row, .shell, .error ...).
//   2. no JSX element in v2 code has both an inline `style` and a `className` (an inline style loses to an `important`
//      utility, so the two together hide a bug).
//   3. every selector in the v2 stylesheets (tokens.css, reset.css) starts with [data-ui="v2"]: nothing global.
// Pure functions (no file or browser access) so vitest can test them; scripts/audit-leaks.mjs reads the files.

export const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every selector list of a stylesheet (at-rule preludes skipped, nested blocks entered). */
export function selectorsOf(css) {
  const out = [];
  for (const m of stripCssComments(css).matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1].split(";").pop().trim();
    if (prelude && !prelude.startsWith("@")) out.push(prelude);
  }
  return out;
}

/**
 * The class combinations a stylesheet reacts to. A compound selector like `.card` reacts to one class (`single`); one like
 * `.sticky-actions.sticky` only reacts to an element that carries BOTH (`multi`), so using `sticky` alone is not a risk.
 * An element qualifier (`a.button`) is ignored: the class alone is treated as the risk (conservative).
 */
export function legacyRules(css) {
  const single = new Set();
  const multi = [];
  for (const list of selectorsOf(css)) {
    for (const sel of splitSelectorList(list)) {
      for (const compound of sel.split(/[\s>+~]+/)) {
        const classes = [...new Set([...compound.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
        if (classes.length === 1) single.add(classes[0]);
        else if (classes.length > 1) multi.push(classes);
      }
    }
  }
  return { single, multi };
}

/** Every class name a stylesheet mentions (for reporting only). */
export function legacyClassNames(css) {
  const names = new Set();
  for (const sel of selectorsOf(css)) for (const m of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(m[1]);
  return names;
}

/** Splits a selector list at its top-level commas (commas inside :where(...), :not(...) or [...] stay). */
export function splitSelectorList(list) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const c of list) {
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Selectors of a v2 stylesheet that are not scoped under [data-ui="v2"]. */
export function unscopedSelectors(css) {
  const bad = [];
  for (const list of selectorsOf(css)) for (const sel of splitSelectorList(list)) if (!sel.startsWith('[data-ui="v2"]')) bad.push(sel);
  return bad;
}

const stringsIn = (expr) => [...expr.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2].replace(/\$\{[^}]*\}/g, " "));

/** The opening tags of JSX in a source text (a small scanner: it understands braces and quotes, not the whole grammar). */
export function jsxOpeningTags(src) {
  const tags = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "<" || !/[A-Za-z]/.test(src[i + 1] ?? "")) continue;
    const before = src.slice(Math.max(0, i - 12), i).trimEnd();
    if (before && !/(^|[(={>?:&|,;]|\breturn|=>)$/.test(before)) continue; // a generic or a comparison, not a tag
    let depth = 0;
    let quote = "";
    let j = i + 1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === "\\") j++;
        else if (c === quote) quote = "";
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push({ index: i, text: src.slice(i, j + 1) });
    i = j;
  }
  return tags;
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

/** Class tokens a source text hands to Tailwind: className attributes and cn()/clsx()/twMerge() calls. */
function classTokens(src) {
  const found = [];
  for (const tag of jsxOpeningTags(src)) {
    const m = tag.text.match(/className\s*=\s*(\{[\s\S]*\}|"[^"]*"|'[^']*')/);
    if (m) for (const s of stringsIn(m[1].startsWith("{") ? m[1] : m[1])) found.push({ index: tag.index, tokens: s.split(/\s+/).filter(Boolean) });
  }
  for (const call of src.matchAll(/\b(?:cn|clsx|twMerge)\(/g)) {
    let depth = 1;
    let k = call.index + call[0].length;
    for (; k < src.length && depth; k++) depth += src[k] === "(" ? 1 : src[k] === ")" ? -1 : 0;
    for (const s of stringsIn(src.slice(call.index + call[0].length, k - 1))) found.push({ index: call.index, tokens: s.split(/\s+/).filter(Boolean) });
  }
  return found;
}

/** Violations in one v2 source file: [{ file, line, rule, detail }]. `legacy` is the result of legacyRules(). */
export function checkSource(src, file, legacy) {
  const out = [];
  for (const { index, tokens } of classTokens(src)) {
    for (const t of tokens) if (legacy.single.has(t)) out.push({ file, line: lineOf(src, index), rule: "legacy-class", detail: `uses the legacy class "${t}"` });
    for (const combo of legacy.multi) {
      if (combo.every((c) => tokens.includes(c))) out.push({ file, line: lineOf(src, index), rule: "legacy-class", detail: `carries the legacy class combination ".${combo.join(".")}"` });
    }
  }
  for (const tag of jsxOpeningTags(src)) {
    if (/\bstyle\s*=/.test(tag.text) && /\bclassName\s*=/.test(tag.text)) {
      out.push({ file, line: lineOf(src, tag.index), rule: "inline-style-with-classes", detail: "has both style and className" });
    }
  }
  return out;
}

/** Fixtures the CLI runs before trusting the check (vitest runs the same ones). */
export function sourceCheckSelfTest() {
  const legacy = { single: new Set(["card", "row", "error"]), multi: [["sticky-actions", "sticky"]] };
  const bad1 = checkSource('const A = () => <div className="card p-4">x</div>;', "f.tsx", legacy);
  const bad2 = checkSource('const A = () => <div style={{ margin: 1 }} className="p-4">x</div>;', "f.tsx", legacy);
  const bad3 = checkSource('const c = cn("p-2", cond && "row");', "f.tsx", legacy);
  const bad4 = checkSource('const A = () => <div className="sticky-actions sticky">x</div>;', "f.tsx", legacy);
  const ok3 = checkSource('const A = () => <header className="sticky top-0">x</header>;', "f.tsx", legacy);
  const ok1 = checkSource('const A = () => <div className="p-4 rounded-lg">error</div>; const s = "error";', "f.tsx", legacy);
  const ok2 = checkSource("const A = () => <div style={{ margin: 1 }}>x</div>; const n = a < b;", "f.tsx", legacy);
  const scopeBad = unscopedSelectors('[data-ui="v2"] a { x: 1 } button { y: 2 }');
  const scopeOk = unscopedSelectors('@media (a) { [data-ui="v2"]:not([x]) { y: 1 } } [data-ui="v2"], [data-ui="v2"] * { z: 1 }');
  const ok = bad1.length === 1 && bad2.length === 1 && bad3.length === 1 && bad4.length === 1 && ok1.length === 0 && ok2.length === 0 && ok3.length === 0 && scopeBad.length === 1 && scopeOk.length === 0;
  return { ok, detail: { bad1: bad1.length, bad2: bad2.length, bad3: bad3.length, bad4: bad4.length, ok1: ok1.length, ok2: ok2.length, ok3: ok3.length, scopeBad: scopeBad.length, scopeOk: scopeOk.length } };
}
