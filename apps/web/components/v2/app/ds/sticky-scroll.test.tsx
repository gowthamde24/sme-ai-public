import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NewPill, useStickyScroll } from "./sticky-scroll";

function Box({ n, k = "a" }: { n: number; k?: string }) {
  const { ref, onScroll, unseen, toBottom } = useStickyScroll<HTMLDivElement>(n, k);
  return (
    <div className="relative">
      <div ref={ref} onScroll={onScroll} data-testid="box">
        {n} lines
      </div>
      <NewPill unseen={unseen} onClick={toBottom} label="↓ New" />
    </div>
  );
}

/** jsdom has no layout: the box is 100 px tall and the content 1000 px; `top` is where the reader is. */
function layout(el: HTMLElement, top: { v: number }) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 1000 });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => top.v, set: (v: number) => (top.v = v) });
}

describe("a transcript that follows the newest line", () => {
  it("stays at the bottom while the reader is there", () => {
    const top = { v: 0 };
    const { rerender } = render(<Box n={1} />);
    layout(screen.getByTestId("box"), top);
    rerender(<Box n={2} />);
    expect(top.v).toBe(1000);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("leaves a reader who scrolled up alone and shows the pill; the pill (or scrolling back) goes to the bottom", () => {
    const top = { v: 900 };
    const { rerender } = render(<Box n={1} />);
    const box = screen.getByTestId("box");
    layout(box, top);
    top.v = 200;
    fireEvent.scroll(box);
    rerender(<Box n={2} />);
    expect(top.v).toBe(200);
    const pill = screen.getByRole("button", { name: "↓ New" });
    act(() => pill.click());
    expect(top.v).toBe(1000);
    expect(screen.queryByRole("button")).toBeNull();
    // scrolled up again, then back down by hand: the pill goes away
    top.v = 100;
    fireEvent.scroll(box);
    rerender(<Box n={3} />);
    expect(screen.getByRole("button")).toBeTruthy();
    top.v = 880;
    fireEvent.scroll(box);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a different chat opens at the bottom, whatever the reader did in the last one", () => {
    const top = { v: 900 };
    const { rerender } = render(<Box n={1} k="a" />);
    const box = screen.getByTestId("box");
    layout(box, top);
    top.v = 0;
    fireEvent.scroll(box);
    rerender(<Box n={5} k="b" />);
    expect(top.v).toBe(1000);
  });
});
