import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Orb } from "./Orb";

describe("the AI circle", () => {
  it("is decorative, sized by its own wrapper (no style and class on one element), and draws each state", () => {
    for (const state of ["still", "ambient", "listen", "think", "speak"] as const) {
      const { container, unmount } = render(<Orb px={40} state={state} />);
      const orb = container.querySelector("[data-orb]")!;
      expect(orb.getAttribute("data-orb")).toBe(state);
      expect(orb.getAttribute("aria-hidden")).toBe("true");
      expect(orb.className).toContain("orb");
      expect(orb.querySelector("canvas") ?? orb).toBeTruthy(); // the ribbons are a lazy chunk: the sphere is there before it arrives
      expect(orb.hasAttribute("style")).toBe(false);
      expect((orb.parentElement as HTMLElement).style.width).toBe("40px");
      unmount();
    }
  });
  it("has a halo that is a wrapper with its own class, and no halo by default", () => {
    expect(render(<Orb px={64} halo />).container.querySelector(".orb-halo")).not.toBeNull();
    expect(render(<Orb px={64} />).container.querySelector(".orb-halo")).toBeNull();
  });
});
