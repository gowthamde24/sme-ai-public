import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NEEDS_EMPTY, needsRowsReserved, NeedsPlaceholder } from "./Placeholders";

afterEach(cleanup);

/**
 * The Needs-you placeholder holds the room of the list that is about to arrive (C2, 19 Nov 2026, "CLS to 0"). The small briefing read says how many things wait; the list is sometimes one longer (Lead Desk, the Lead Finder, the plan's upsell row), so one row more is reserved.
 * The heights are the MEASURED ones: at 390 px a real row of two title lines is 80 px (the most a row can be), the list adds 1 px of border at each end and 1 px between rows (n rows = 81 n + 1), the empty state is 44 px, and the heading row is 44 px (not 28) once "See all" joins it (more than three rows).
 */
const card = () => document.querySelector<HTMLElement>("[data-placeholder] > div:last-child") as HTMLElement;
const heading = () => document.querySelector<HTMLElement>("[data-placeholder] > :first-child") as HTMLElement;

describe("how many rows of Needs you the placeholder reserves", () => {
  it("one more than the count, never more than six; none (the empty state) for 0; three when the count is not known", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 40].map(needsRowsReserved)).toEqual([0, 2, 3, 4, 5, 6, 6, 6, 6]);
    expect(needsRowsReserved(null)).toBe(3);
    expect(needsRowsReserved(-1)).toBe(0);
  });

  it.each([
    [1, 2, "min-h-[163px]"],
    [2, 3, "min-h-[244px]"],
    [3, 4, "min-h-[325px]"],
    [4, 5, "min-h-[406px]"],
    [5, 6, "min-h-[487px]"],
    [6, 6, "min-h-[487px]"],
    [12, 6, "min-h-[487px]"],
    [null, 3, "min-h-[244px]"],
  ])("a count of %s reserves %s rows (%s on a phone)", (count, rows, height) => {
    render(<NeedsPlaceholder rows={count} />);
    expect(document.querySelector("[data-reserved-rows]")).toHaveAttribute("data-reserved-rows", String(rows));
    expect(card().className).toContain(height);
    expect(card().className).toContain("lg:min-h-[223px]"); // the desktop keeps its one height
  });

  it("a count of 0 reserves the empty state's own height, not a list", () => {
    render(<NeedsPlaceholder rows={0} />);
    expect(card().className).toContain(NEEDS_EMPTY);
    expect(NEEDS_EMPTY).toBe("min-h-[44px]");
  });

  it("the heading row is the 44 px one once more than three rows are held (the See all button), the 28 px one otherwise", () => {
    render(<NeedsPlaceholder rows={2} />); // three rows
    expect(heading().className).toContain("h-7");
    cleanup();
    render(<NeedsPlaceholder rows={3} />); // four rows
    expect(heading().className).toContain("h-11");
  });

  it("the measured heights add up: n rows is 81 n + 1 px", () => {
    const px = (c: string) => Number(/min-h-\[(\d+)px\]/.exec(c)?.[1]);
    for (let count = 1; count <= 5; count += 1) {
      render(<NeedsPlaceholder rows={count} />);
      expect(px(card().className)).toBe(81 * Math.min(count + 1, 6) + 1);
      cleanup();
    }
  });
});
