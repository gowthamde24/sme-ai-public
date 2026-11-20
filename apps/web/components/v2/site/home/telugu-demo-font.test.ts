import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { STACK, stackWith } from "./chat-stack";

describe("the cut-down Telugu font of the home page's sample call (every page that is not in Telugu)", () => {
  const dir = path.join(__dirname, "../../../../design/indic-fonts");
  const have = new Set([...fs.readFileSync(path.join(dir, "NotoSansTelugu-demo.codepoints.txt"), "utf8").trim()]);
  const telugu = (s: string) => [...s].filter((c) => c.codePointAt(0)! >= 0x0c00 && c.codePointAt(0)! <= 0x0c7f);
  it("has every Telugu letter of the sample's call and chat lines (today's greeting and the name-only one) and of the language name", () => {
    const text = [...STACK, ...stackWith(false)].flatMap((c) => [c.day, ...c.call.lines.map((l) => l.text), c.call.ended, c.call.you, ...c.lines.map((l) => l.text)]).join(" ") + " తెలుగు";
    const missing = [...new Set(telugu(text))].filter((c) => !have.has(c));
    expect(missing, "run design/indic-fonts/make-telugu-demo.py").toEqual([]);
  });
  it("is much smaller than the full font", () => {
    expect(fs.statSync(path.join(dir, "NotoSansTelugu-demo.woff2")).size).toBeLessThan(fs.statSync(path.join(dir, "NotoSansTelugu-400-700.woff2")).size / 2);
  });
});
