import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlushStill } from "./PlushStill";

describe("PlushStill (the main agent as an avatar of 56 to 112 px)", () => {
  it("is the 128 or 256 px still by the size, from the versioned folder, decorative, and lazy", () => {
    const small = renderToStaticMarkup(<PlushStill px={56} className="size-14" />);
    expect(small).toContain('src="/owl/v4/main/owlet-full-128.webp"');
    expect(small).toContain('srcSet="/owl/v4/main/owlet-full-128.webp 128w, /owl/v4/main/owlet-full-256.webp 256w"');
    expect(small).toContain('sizes="56px"');
    expect(small).toContain('alt=""');
    expect(small).toContain('aria-hidden="true"');
    expect(small).toContain('loading="lazy"');
    expect(small).toContain('width="512"');
    expect(small).not.toContain("512w"); // never the biggest file
  });
  it("offers a bigger owl its 256 and 512 px files (1x and 2x), the smallest one that is not smaller than the size as the fallback, and a second size from 640 px up", () => {
    const big = renderToStaticMarkup(<PlushStill px={160} smPx={192} mood="answering" className="size-40 sm:size-48" />);
    expect(big).toContain('src="/owl/v4/main/owlet-full-256.webp"');
    expect(big).toContain('srcSet="/owl/v4/main/owlet-full-256.webp 256w, /owl/v4/main/owlet-full-512.webp 512w"');
    expect(big).toContain('sizes="(min-width: 640px) 192px, 160px"');
    expect(big).toContain('data-mood="answering"');
    const mid = renderToStaticMarkup(<PlushStill px={80} smPx={96} className="size-20 sm:size-24" />);
    expect(mid).toContain('srcSet="/owl/v4/main/owlet-full-128.webp 128w, /owl/v4/main/owlet-full-256.webp 256w"');
  });
  it("uses the agent's own folder: the colour of a helper is its own, and an unknown id is Agent OWL", () => {
    expect(renderToStaticMarkup(<PlushStill px={48} agent="order_desk" />)).toContain('src="/owl/v4/order_desk/owlet-full-128.webp"');
    expect(renderToStaticMarkup(<PlushStill px={48} agent="nobody" />)).toContain('src="/owl/v4/main/owlet-full-128.webp"');
  });
});
