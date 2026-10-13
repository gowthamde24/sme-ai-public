import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// next/font only works inside the Next build: each font becomes an object with a fixed variable class.
type LocalOptions = { src: Array<{ path: string; weight: string }>; variable: string; preload: boolean; declarations: Array<{ prop: string; value: string }> };
const localCalls = vi.hoisted((): LocalOptions[] => []);
vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ variable: `var-${name}` });
  return { Plus_Jakarta_Sans: font("sans"), Bricolage_Grotesque: font("display") };
});
vi.mock("next/font/local", () => ({
  default: (options: LocalOptions) => {
    localCalls.push(options);
    return { variable: `var-${options.variable.replace("--v2-font-", "")}` };
  },
}));

import { v2FontClassName } from "@/design/fonts";

describe("v2FontClassName: a page downloads only the Indic font of its own language", () => {
  it("English gets the two Latin fonts and no Indic font", () => {
    expect(v2FontClassName("en")).toBe("var-sans var-display");
  });
  it("each Indic language adds exactly its own font", () => {
    expect(v2FontClassName("te")).toBe("var-sans var-display var-telugu");
    expect(v2FontClassName("hi")).toBe("var-sans var-display var-devanagari");
    expect(v2FontClassName("kn")).toBe("var-sans var-display var-kannada");
  });
  it("an unknown language gets none, and no language at all gets all three", () => {
    expect(v2FontClassName("fr")).toBe("var-sans var-display");
    expect(v2FontClassName()).toBe("var-sans var-display var-telugu var-devanagari var-kannada");
  });
});

describe("the Indic fonts are the cut files in design/indic-fonts (job CH)", () => {
  const dir = path.join(__dirname, "indic-fonts");
  const FILES = { "--v2-font-telugu": "NotoSansTelugu-400-700.woff2", "--v2-font-devanagari": "NotoSansDevanagari-400-700.woff2", "--v2-font-kannada": "NotoSansKannada-400-700.woff2" };
  // the sizes that were measured when the files were made; a bigger file means the weight axis was widened again (the whole point is not to ship 100 to 900)
  const CEILING = { "--v2-font-telugu": 70_000, "--v2-font-devanagari": 90_000, "--v2-font-kannada": 52_000 };

  it("each language's font is its own local file, 400 to 700, never preloaded, with a unicode-range", () => {
    expect(localCalls.map((c) => c.variable).sort()).toEqual(Object.keys(FILES).sort());
    for (const call of localCalls) {
      expect(call.src).toHaveLength(1);
      expect(call.src[0].path).toBe(`./indic-fonts/${FILES[call.variable as keyof typeof FILES]}`);
      expect(call.src[0].weight).toBe("400 700");
      expect(call.preload).toBe(false);
      expect(call.declarations.find((d) => d.prop === "unicode-range")?.value).toMatch(/^U\+/);
    }
  });
  it("every font loader is a plain `const x = localFont({...})` in the module (the build refuses a helper around it: the unit test cannot see that, the build does)", () => {
    const source = fs.readFileSync(path.join(__dirname, "fonts.ts"), "utf8");
    const calls = source.split("\n").filter((line) => line.includes("localFont("));
    expect(calls.length).toBe(3);
    for (const line of calls) expect(line).toMatch(/^const \w+ = localFont\(\{$/);
  });
  it("the files exist, are woff2, stay under their measured size, and the licence is next to them", () => {
    for (const [variable, file] of Object.entries(FILES)) {
      const bytes = fs.readFileSync(path.join(dir, file));
      expect(bytes.subarray(0, 4).toString("latin1"), file).toBe("wOF2");
      expect(bytes.length, file).toBeLessThanOrEqual(CEILING[variable as keyof typeof CEILING]);
    }
    expect(fs.readFileSync(path.join(dir, "OFL.txt"), "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });
});
