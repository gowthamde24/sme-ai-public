import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LANGS } from "@/i18n/lang";
import { siteT } from "@/i18n/site";

import { SupportedBy } from "./SupportedBy";

const brand = (f: string) => readFileSync(path.join(process.cwd(), "public/brand", f), "utf8");

describe("Supported by Cartesia (the footer row)", () => {
  it.each(LANGS)("%s: the words, one link to cartesia.ai, both of Cartesia's own files, the name only as 'Cartesia'", (lang) => {
    const t = siteT(lang);
    const html = renderToStaticMarkup(<SupportedBy t={t} />);
    expect(html).toContain(t("foot.supported"));
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="https://cartesia.ai"');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain('src="/brand/cartesia-startups-black.svg"');
    expect(html).toContain('src="/brand/cartesia-startups-white.svg"');
    expect(html.match(/alt="Cartesia"/g)).toHaveLength(2);
    expect(html).not.toMatch(/Cartesia AI/);
  });

  it("does not stretch, fade or filter the lockup (their brand rules)", () => {
    const html = renderToStaticMarkup(<SupportedBy t={siteT("en")} />);
    expect(html).not.toMatch(/<img[^>]*(style=|opacity|filter|shadow|blur)/);
  });

  it("the files are Cartesia's own, unchanged in shape: one symbol-and-wordmark file each, black #1E1C1A on light, white #FEFEFE on dark, no script and no link out", () => {
    const black = brand("cartesia-startups-black.svg");
    const white = brand("cartesia-startups-white.svg");
    for (const svg of [black, white]) {
      expect(svg.startsWith("<svg ")).toBe(true);
      expect(svg).toContain('viewBox="0 0 311 32"');
      expect(svg).not.toMatch(/<script|<image|href=|onload/i);
    }
    expect(black).toContain('fill="#1E1C1A"');
    expect(black).not.toContain("#FEFEFE");
    expect(white).toContain('fill="#FEFEFE"');
    expect(white).not.toContain("#1E1C1A");
  });
});
