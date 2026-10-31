import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BusinessLogo, initialsOf } from "./BusinessLogo";

afterEach(cleanup);

describe("the business's mark at the top of the menu", () => {
  it("is the uploaded logo when there is one", () => {
    const { container } = render(<BusinessLogo name="Neelambari Silks" url="https://s.example/logo.png?sig=1" />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).toHaveAttribute("src", "https://s.example/logo.png?sig=1");
    expect(img).toHaveAttribute("alt", ""); // the business name is next to it
    expect(container.querySelector('[data-business-logo="letters"]')).toBeNull();
  });
  it("is a letter avatar of the business name in the brand colours when there is none", () => {
    const { container } = render(<BusinessLogo name="Neelambari Silks (demo)" url={null} />);
    const avatar = container.querySelector('[data-business-logo="letters"]') as HTMLElement;
    expect(avatar).toHaveTextContent("NS");
    expect(avatar.className).toContain("bg-brand");
    expect(avatar.className).toContain("text-on-brand");
  });
  it("falls back to the letters when the picture cannot be loaded (an expired address)", () => {
    const { container } = render(<BusinessLogo name="Sri Sai Homes" url="https://s.example/old.png" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-business-logo="letters"]')).toHaveTextContent("SS");
  });
  it("takes the first letters of the first two words, in capitals, in any script", () => {
    expect(initialsOf("neelambari silks")).toBe("NS");
    expect(initialsOf("Acme")).toBe("A");
    expect(initialsOf("శ్రీ లక్ష్మి సిల్క్స్")).toBe("శ్ల".length ? Array.from("శ్రీ")[0] + Array.from("లక్ష్మి")[0] : "");
    expect(initialsOf("  --  ")).toBe("?");
  });
});
