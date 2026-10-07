import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { checkSource, jsxOpeningTags, legacyClassNames, selectorsOf, sourceCheckSelfTest, unscopedSelectors } from "./source-check.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("leak audit: source check", () => {
  it("passes its own fixtures (the CLI runs the same ones before trusting itself)", () => {
    expect(sourceCheckSelfTest().ok).toBe(true);
  });
  it("reads selectors past at-rules and imports", () => {
    expect(selectorsOf('@import "x";\n@media (a) { .a, .b { c: d } }\nbutton:disabled { e: f }')).toEqual([".a, .b", "button:disabled"]);
  });
  it("finds the legacy class names in the real globals.css, including those after an element selector", () => {
    const names = legacyClassNames(read("app/globals.css"));
    for (const n of ["shell", "card", "row", "error", "hint", "tabs", "tap", "button", "secondary", "badge"]) expect(names.has(n), n).toBe(true);
    expect(names.size).toBeGreaterThan(30);
  });
  it("flags a legacy class and an inline style next to classes, with line numbers", () => {
    const legacy = legacyClassNames(read("app/globals.css"));
    const src = ["export const A = () => (", '  <section className="shell p-4">', '    <p style={{ color: "red" }} className="text-sm">x</p>', "  </section>", ");"].join("\n");
    const v = checkSource(src, "A.tsx", legacy);
    expect(v.map((x) => `${x.rule}@${x.line}`).sort()).toEqual(["inline-style-with-classes@3", "legacy-class@2"]);
  });
  it("does not mistake generics, comparisons or plain words for tags or classes", () => {
    const legacy = new Set(["error"]);
    const src = 'const [a, setA] = useState<string>("error"); const x = a < b ? "error" : "ok"; type T = Array<number>;';
    expect(jsxOpeningTags(src)).toEqual([]);
    expect(checkSource(src, "x.ts", legacy)).toEqual([]);
  });
  it("the v2 stylesheets have no selector outside [data-ui=v2]", () => {
    expect(unscopedSelectors(read("design/tokens.css"))).toEqual([]);
    expect(unscopedSelectors(read("design/reset.css"))).toEqual([]);
    expect(unscopedSelectors("body { margin: 0 }")).toEqual(["body"]);
  });
  it("the v2 sources in the repository pass", () => {
    const legacy = legacyClassNames(read("app/globals.css"));
    const files = fs.readdirSync(path.join(root, "components/v2")).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(checkSource(read(`components/v2/${f}`), f, legacy)).toEqual([]);
  });
});
