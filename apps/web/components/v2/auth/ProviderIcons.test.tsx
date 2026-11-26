import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FacebookF, GoogleG } from "./ProviderIcons";
import { authSecondary } from "./ui";

afterEach(cleanup);

describe("the providers' marks on the sign-in buttons (owner, 26 Nov 2026)", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`Google's four-colour G is drawn, unaltered, in a white badge, left of the label, in the ${theme} theme`, () => {
      render(
        <div data-theme={theme}>
          <button type="submit" className={`${authSecondary} gap-2.5`}>
            <GoogleG />
            Continue with Google
          </button>
        </div>,
      );
      const button = screen.getByRole("button", { name: "Continue with Google" }); // the label is the name; the icon adds nothing to it
      const badge = button.querySelector('[data-provider-icon="google"]') as HTMLElement;
      expect(badge).not.toBeNull();
      expect(badge.firstElementChild).toBe(button.querySelector("svg"));
      expect(button.firstElementChild).toBe(badge); // left of the words
      expect(badge).toHaveAttribute("aria-hidden", "true");
      expect(badge).toHaveClass("bg-white", "size-[22px]"); // a light surround whatever the theme: the G keeps its own colours
      const svg = button.querySelector("svg") as SVGElement;
      expect([svg.getAttribute("width"), svg.getAttribute("height"), svg.getAttribute("focusable")]).toEqual(["18", "18", "false"]); // 18 px inside 22: clear space, not stretched
      expect([...svg.querySelectorAll("path")].map((p) => p.getAttribute("fill")).sort()).toEqual(["#34A853", "#4285F4", "#EA4335", "#FBBC05"]); // Google's own four colours, none recoloured
      expect(button.querySelectorAll("a,button,[tabindex]")).toHaveLength(0); // no focus stop of its own: the button keeps the keyboard focus
    });
  }
  it("Facebook's f is drawn the same way (blue disc, white f)", () => {
    render(
      <button type="submit" className={authSecondary}>
        <FacebookF />
        Continue with Facebook
      </button>,
    );
    const badge = screen.getByRole("button", { name: "Continue with Facebook" }).querySelector('[data-provider-icon="facebook"]') as HTMLElement;
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect([...badge.querySelectorAll("path")].map((p) => p.getAttribute("fill"))).toEqual(["#1877F2", "#fff"]);
  });
});
