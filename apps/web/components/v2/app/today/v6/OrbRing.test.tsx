import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrbRing, tickRingDrawer } from "./OrbRing";

afterEach(cleanup);

describe("the orb in its tick ring (the approved mock)", () => {
  it("is the product's own orb inside a canvas ring: one orb, never a drawing of ours", () => {
    const { container } = render(<OrbRing state="speak" />);
    expect(container.querySelectorAll("[data-orb]")).toHaveLength(1);
    expect(container.querySelector("[data-orb]")).toHaveAttribute("data-orb", "speak");
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(container.querySelector('[data-part="orb-ring"]')).toHaveClass("size-[104px]");
  });

  it("draws a pale ring and the orange bars, taller while it speaks, and nothing in a box that is too small", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, { get: (_t, k) => (typeof k === "string" && ["arc", "stroke", "moveTo", "lineTo", "beginPath", "clearRect", "setTransform"].includes(k) ? () => calls.push(k) : undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
    tickRingDrawer(() => ({ motion: "speaking" }))(ctx, 208, 208, 1, { dpr: 2, dark: false });
    expect(calls.filter((c) => c === "arc")).toHaveLength(1);
    expect(calls.filter((c) => c === "lineTo")).toHaveLength(72);
    calls.length = 0;
    tickRingDrawer(() => ({ motion: "idle" }))(ctx, 20, 20, 1, { dpr: 1 });
    expect(calls.filter((c) => c === "arc")).toHaveLength(0);
    vi.restoreAllMocks();
  });
});
