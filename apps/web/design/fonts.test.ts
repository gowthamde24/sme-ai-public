import { describe, expect, it, vi } from "vitest";

// next/font only works inside the Next build: each font becomes an object with a fixed variable class.
vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ variable: `var-${name}` });
  return {
    Plus_Jakarta_Sans: font("sans"),
    Bricolage_Grotesque: font("display"),
    Noto_Sans_Telugu: font("telugu"),
    Noto_Sans_Devanagari: font("devanagari"),
    Noto_Sans_Kannada: font("kannada"),
  };
});

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
