import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useKeyboardInset } from "./use-keyboard-inset";

function Panel({ enabled = true, onChange }: { enabled?: boolean; onChange?: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  useKeyboardInset(ref, enabled, onChange);
  return <div ref={ref} data-testid="p" />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the panel above the on-screen keyboard", () => {
  it("writes how far the keyboard covers the page and the height that is left, and follows the visual viewport", () => {
    const listeners: Record<string, () => void> = {};
    const vv = { height: 800, offsetTop: 0, addEventListener: (n: string, f: () => void) => (listeners[n] = f), removeEventListener: vi.fn() };
    vi.stubGlobal("visualViewport", vv);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const seen = vi.fn();
    const { getByTestId, unmount } = render(<Panel onChange={seen} />);
    const el = getByTestId("p");
    expect(el.style.getPropertyValue("--kb")).toBe("0px");
    vv.height = 500; // the keyboard opens
    act(() => listeners.resize());
    expect(el.style.getPropertyValue("--kb")).toBe("300px");
    expect(el.style.getPropertyValue("--vvh")).toBe("500px");
    expect(seen).toHaveBeenCalled();
    unmount();
    expect(vv.removeEventListener).toHaveBeenCalled();
  });
  it("does nothing when it is off or there is no visual viewport", () => {
    vi.stubGlobal("visualViewport", undefined);
    const { getByTestId } = render(<Panel />);
    expect(getByTestId("p").style.getPropertyValue("--kb")).toBe("");
  });
});
