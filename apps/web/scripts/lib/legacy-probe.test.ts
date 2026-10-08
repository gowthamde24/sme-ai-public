import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// audit:leaks compares legacy markup with the v2 stylesheet on and off (the "reverse" audit). Since Stage 3 no screen
// that loads without a session is a legacy screen any more, so that markup is a hand-written probe. This test stops the
// probe from drifting away from the real legacy stylesheet.
const ROOT = path.resolve(__dirname, "../..");
const css = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
const probe = fs.readFileSync(path.join(ROOT, "scripts/audit/legacy-probe.html"), "utf8");

const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const probeClasses = new Set([...probe.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));

describe("legacy probe", () => {
  it("uses only class names that exist as selectors in app/globals.css", () => {
    const missing = [...probeClasses].filter((c) => !cssClasses.has(c));
    expect(missing, `probe classes with no rule in globals.css: ${missing.join(", ")}`).toEqual([]);
  });
  it("covers the classes the five sign-in and account screens used before Stage 3", () => {
    for (const c of ["shell", "card", "error", "hint", "row", "secondary"]) expect(probeClasses.has(c), c).toBe(true);
  });
  it("covers the legacy element rules too: h1/h2, button (and disabled), table, td, select, textarea, input", () => {
    for (const tag of ["<h1", "<h2", "<button", " disabled", "<table", "<td", "<select", "<textarea", "<input"]) expect(probe, tag).toContain(tag);
  });
  it("contains no script, no style element and no inline style (the page's CSP would refuse them)", () => {
    expect(probe).not.toMatch(/<script|<style|\sstyle=/);
  });
  it("the stylesheet still has the six classes (a test that guards against the probe asking for nothing)", () => {
    for (const c of ["shell", "card", "error", "hint", "row", "secondary"]) expect(cssClasses.has(c), c).toBe(true);
  });
});
