import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TalkOrb } from "./TalkOrb";

afterEach(cleanup);

describe("the talk orb (owner review, 1 Nov)", () => {
  it("is a solid circle in the accent colour with a waveform on it, not the glass sphere", () => {
    const { container } = render(<TalkOrb px={64} />);
    const orb = container.querySelector("[data-orb]") as HTMLElement;
    expect(orb.className).toContain("bg-brand");
    expect(orb.className).toContain("rounded-full");
    expect(orb.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("canvas, img")).toBeNull(); // no swirl picture
    expect((orb.parentElement as HTMLElement).style.width).toBe("64px");
  });
  it("names its state, and the waveform pulses while it thinks or speaks", () => {
    const still = render(<TalkOrb px={64} state="ambient" />);
    expect(still.container.querySelector("[data-orb]")).toHaveAttribute("data-orb", "ambient");
    expect(still.container.querySelector("svg")!.getAttribute("class")).not.toContain("animate-pulse");
    cleanup();
    const speaking = render(<TalkOrb px={64} state="speak" />);
    expect(speaking.container.querySelector("svg")!.getAttribute("class")).toContain("animate-pulse");
  });
});
