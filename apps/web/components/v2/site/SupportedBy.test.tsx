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
    expect(html).toContain('src="/brand/cartesia-startups-primary.svg"');
    expect(html).toContain('src="/brand/cartesia-startups-white.svg"');
    expect(html.match(/alt="Cartesia"/g)).toHaveLength(2);
    expect(html).not.toMatch(/Cartesia AI/);
  });

  it("does not stretch, fade or filter the lockup (their brand rules)", () => {
    const html = renderToStaticMarkup(<SupportedBy t={siteT("en")} />);
    expect(html).not.toMatch(/<img[^>]*(style=|opacity|filter|shadow|blur)/);
  });

  it("the files are Cartesia's own, unchanged: one symbol-and-wordmark file each; the primary one has the green symbol (#309D4B) and the dark wordmark (#1E1C1A), the white one is all #FEFEFE; no script and no link out", () => {
    const primary = brand("cartesia-startups-primary.svg");
    const white = brand("cartesia-startups-white.svg");
    for (const svg of [primary, white]) {
      expect(svg.startsWith("<svg ")).toBe(true);
      expect(svg).not.toMatch(/<script|<image|href=|onload/i);
    }
    expect(primary).toContain('viewBox="0 0 604 62"');
    expect(primary.match(/fill="#309D4B"/g)).toHaveLength(1);
    expect(primary).toContain('fill="#1E1C1A"');
    expect(primary).not.toContain("#FEFEFE");
    expect(white).toContain('viewBox="0 0 311 32"');
    expect(white).toContain('fill="#FEFEFE"');
    expect(white).not.toMatch(/#1E1C1A|#309D4B/);
  });
});
