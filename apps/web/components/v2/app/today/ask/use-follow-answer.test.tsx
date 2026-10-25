import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BOTTOM_ON_LAPTOP, BOTTOM_ON_PHONE, TOP_GAP, followDelta, useFollowAnswer } from "./use-follow-answer";

describe("followDelta: the smallest scroll that shows the newest words (job DH)", () => {
  it("does nothing when the answer area already ends above the foot of the screen", () => {
    expect(followDelta({ top: 300, bottom: 600 }, 844, 390)).toBe(0); // phone: the foot starts at 844 - 168 = 676
    expect(followDelta({ top: 300, bottom: 870 }, 900, 1280)).toBe(0); // laptop: the foot starts at 900 - 24 = 876
  });
  it("on a phone lifts the bottom above the question bar and the tab bar", () => {
    expect(followDelta({ top: 500, bottom: 700 }, 844, 390)).toBe(700 - (844 - BOTTOM_ON_PHONE));
  });
  it("on a laptop a first line at the very bottom edge is brought up", () => {
    expect(followDelta({ top: 840, bottom: 960 }, 900, 1280)).toBe(960 - (900 - BOTTOM_ON_LAPTOP));
  });
  it("never pushes the question line off the top: a long answer stops at the header", () => {
    expect(followDelta({ top: 150, bottom: 1500 }, 844, 390)).toBe(150 - TOP_GAP);
    expect(followDelta({ top: 60, bottom: 1500 }, 844, 390)).toBe(0); // already at or above the gap: nothing more to scroll
  });
});

/** A bare component around the hook: a button grows the answer, another starts a new question, another ends it. */
function Probe() {
  const [run, setRun] = React.useState(1);
  const [asking, setAsking] = React.useState(true);
  const [text, setText] = React.useState("");
  const ref = useFollowAnswer(run, asking, text);
  return (
    <div>
      <div ref={ref} data-testid="area" />
      <button onClick={() => setText((t) => `${t}x`)}>grow</button>
      <button onClick={() => setRun((n) => n + 1)}>again</button>
      <button onClick={() => setAsking(false)}>end</button>
    </div>
  );
}
const press = (name: string) => act(async () => void fireEvent.click(document.querySelector(`button:nth-of-type(${["grow", "again", "end"].indexOf(name) + 1})`)!));

let scrollBy: ReturnType<typeof vi.fn>;
let reduced = false;
beforeEach(() => {
  scrollBy = vi.fn();
  Object.defineProperty(window, "scrollBy", { configurable: true, writable: true, value: scrollBy });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 844 });
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 500, bottom: 900, left: 0, right: 390, width: 390, height: 400, x: 0, y: 500, toJSON: () => ({}) });
  reduced = false;
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: (q: string) => ({ matches: reduced && /reduce/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {} }) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useFollowAnswer", () => {
  it("scrolls as the answer grows while it is being asked, by the smallest amount, gliding", async () => {
    render(<Probe />);
    expect(scrollBy).toHaveBeenCalledWith({ top: 900 - (844 - BOTTOM_ON_PHONE), behavior: "smooth" }); // the first line is brought in as the question starts
    scrollBy.mockClear();
    await press("grow");
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0][0]).toMatchObject({ top: 224, behavior: "smooth" });
  });
  it("jumps instead of gliding when the person asked for reduced motion", async () => {
    reduced = true;
    render(<Probe />);
    expect(scrollBy.mock.calls[0][0]).toMatchObject({ behavior: "auto" });
  });
  it("stops following when the person scrolls themselves (wheel, touch or an up key), and follows again for the next question", async () => {
    render(<Probe />);
    scrollBy.mockClear();
    fireEvent.wheel(window);
    await press("grow");
    expect(scrollBy).not.toHaveBeenCalled();
    await press("again");
    expect(scrollBy).toHaveBeenCalledTimes(1); // a new question: the page follows again
    scrollBy.mockClear();
    fireEvent.touchMove(window);
    await press("grow");
    expect(scrollBy).not.toHaveBeenCalled();
    await press("again");
    scrollBy.mockClear();
    fireEvent.keyDown(window, { key: "ArrowUp" });
    await press("grow");
    expect(scrollBy).not.toHaveBeenCalled();
  });
  it("a key that does not go up does not stop it, and nothing moves once the answer is whole", async () => {
    render(<Probe />);
    scrollBy.mockClear();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    await press("grow");
    expect(scrollBy).toHaveBeenCalledTimes(1);
    scrollBy.mockClear();
    await press("end");
    await press("grow");
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
