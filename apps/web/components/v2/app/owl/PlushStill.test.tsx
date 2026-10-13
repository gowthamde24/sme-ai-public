import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlushStill } from "./PlushStill";

describe("PlushStill (the main agent as an avatar of 56 to 112 px)", () => {
  it("is the 128 or 256 px still by the size, from the versioned folder, decorative, and lazy", () => {
    const small = renderToStaticMarkup(<PlushStill px={56} className="size-14" />);
    expect(small).toContain('src="/owl/v2/owlet-full-128.webp"');
    expect(small).toContain('srcSet="/owl/v2/owlet-full-128.webp 128w, /owl/v2/owlet-full-256.webp 256w"');
    expect(small).toContain('sizes="56px"');
    expect(small).toContain('alt=""');
    expect(small).toContain('aria-hidden="true"');
    expect(small).toContain('loading="lazy"');
    expect(small).toContain('width="512"');
    expect(small).not.toContain("512w"); // never the biggest file
  });
  it("takes the larger file as its fallback from 80 px, and a second size from 640 px up", () => {
    const big = renderToStaticMarkup(<PlushStill px={80} smPx={96} mood="answering" className="size-20 sm:size-24" />);
    expect(big).toContain('src="/owl/v2/owlet-full-256.webp"');
    expect(big).toContain('sizes="(min-width: 640px) 96px, 80px"');
    expect(big).toContain('data-mood="answering"');
  });
});
