import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// the whole rename: this one module
vi.mock("@/design/brand", () => ({ BRAND_NAME: "Rename Test (working name)", BRAND_TEXT: "Rename⁠Test (working name)" }));

import { LandingView } from "@/components/v2/landing/LandingView";

describe("renaming the product is one edit", () => {
  it("every place the page shows the name follows the constant, and the old name is nowhere", () => {
    const html = renderToStaticMarkup(<LandingView lang="en" />);
    expect(html).toContain("Rename");
    expect(html).toContain('aria-label="Rename Test (working name)"');
    expect(html).not.toMatch(/sme-?ai/i);
    expect(html).not.toContain("{brand}");
  });
});
