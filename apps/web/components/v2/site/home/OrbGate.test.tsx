import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrbGate } from "./OrbGate";

const media = (matches: boolean) => (q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false });

describe("the hero's orb gate: no orb on a phone", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it("renders nothing on the server and under 768 px (not rendered, not merely hidden)", () => {
    expect(renderToStaticMarkup(<OrbGate><i data-orb="" /></OrbGate>)).toBe("");
    vi.stubGlobal("matchMedia", media(false));
    const { container } = render(<OrbGate><i data-orb="" /></OrbGate>);
    expect(container.querySelector("[data-orb]")).toBeNull();
  });
  it("mounts the stage from 768 px up", () => {
    vi.stubGlobal("matchMedia", media(true));
    const { container } = render(<OrbGate><i data-orb="" /></OrbGate>);
    expect(container.querySelector("[data-orb]")).not.toBeNull();
  });
});
