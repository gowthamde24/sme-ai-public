import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ratio, readTokens, runContrast } from "./contrast.mjs";

const css = fs.readFileSync(path.resolve(import.meta.dirname, "../../design/tokens.css"), "utf8");

describe("design v2 tokens: contrast", () => {
  it("computes known ratios", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(ratio("#777777", "#777777")).toBeCloseTo(1, 5);
  });
  it("every check passes in light and dark", () => {
    const r = runContrast(css);
    expect(r.rows.filter((x) => !x.ok).map((x) => `${x.mode} ${x.label} ${x.ratio.toFixed(2)}`)).toEqual([]);
    expect(r.total).toBe(52);
  });
  it("the dark tokens are the same in the attribute block and in the media-query block", () => {
    expect(runContrast(css).mediaMatchesDark).toBe(true);
  });
  it("fails loudly on a token that no longer passes", () => {
    const broken = css.replace("--v2-muted: #6d6a67;", "--v2-muted: #bbbbbb;");
    expect(runContrast(broken).failures).toBeGreaterThan(0);
  });
  it("reads the colour tokens only (no :root, no unscoped selector)", () => {
    expect(Object.keys(readTokens(css).light).length).toBeGreaterThan(20);
    expect(css).not.toMatch(/(^|\n)\s*:root/);
  });
});
