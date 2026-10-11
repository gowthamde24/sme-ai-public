import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { PhotoTray, indexAt, type TraySlot } from "./PhotoTray";
import { WORDS } from "./catalogue-test-kit";

afterEach(cleanup);
const slot = (key: string, over: Partial<TraySlot> = {}): TraySlot => ({ key, src: `https://s.example/${key}.jpg`, fresh: false, status: "saved", percent: 0, error: null, ...over });
const SLOTS = [slot("a"), slot("b"), slot("c")];
const show = (over: Partial<React.ComponentProps<typeof PhotoTray>> = {}) => {
  const fns = { onMove: vi.fn(), onRemove: vi.fn(), onRetry: vi.fn() };
  render(<PhotoTray slots={SLOTS} words={WORDS} name="Saree" disabled={false} {...fns} {...over} />);
  return fns;
};
const row = (n: number) => document.querySelectorAll("[data-tray=photos] > li")[n - 1] as HTMLElement;

describe("the photo tray", () => {
  it("the first photo is the cover; each photo says its place", () => {
    show();
    expect(within(row(1)).getByText("Cover")).toBeInTheDocument();
    expect(within(row(2)).queryByText("Cover")).toBeNull();
    expect(within(row(3)).getByText("Photo 3 of 3")).toBeInTheDocument();
    expect(row(1)).toHaveAttribute("data-cover", "true");
  });

  it("moves a photo one place with the arrow buttons (not past either end) and says where it went", () => {
    const { onMove } = show();
    expect(within(row(1)).getByRole("button", { name: "Move photo 1 earlier" })).toBeDisabled();
    expect(within(row(3)).getByRole("button", { name: "Move photo 3 later" })).toBeDisabled();
    fireEvent.click(within(row(2)).getByRole("button", { name: "Move photo 2 later" }));
    expect(onMove).toHaveBeenLastCalledWith(1, 2);
    fireEvent.click(within(row(2)).getByRole("button", { name: "Move photo 2 earlier" }));
    expect(onMove).toHaveBeenLastCalledWith(1, 0);
    expect(screen.getByRole("status")).toHaveTextContent("Photo moved to place 1 of 3.");
  });

  it("makes a photo the cover with one button (the cover itself has none)", () => {
    const { onMove } = show();
    expect(within(row(1)).queryByRole("button", { name: /the cover/ })).toBeNull();
    fireEvent.click(within(row(3)).getByRole("button", { name: "Make photo 3 the cover" }));
    expect(onMove).toHaveBeenCalledWith(2, 0);
  });

  it("moves with the arrow keys on the drag handle, so the handle works without a mouse", () => {
    const { onMove } = show();
    const handle = within(row(2)).getByRole("button", { name: "Drag photo 2" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onMove).toHaveBeenLastCalledWith(1, 2);
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onMove).toHaveBeenLastCalledWith(1, 0);
    onMove.mockClear();
    fireEvent.keyDown(within(row(1)).getByRole("button", { name: "Drag photo 1" }), { key: "ArrowUp" });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("drags by the handle with a pointer (mouse or finger) and drops where the pointer is", () => {
    const { onMove } = show();
    const tops = [0, 100, 200];
    [1, 2, 3].forEach((n, i) => (row(n).getBoundingClientRect = () => ({ top: tops[i], bottom: tops[i] + 100, left: 0, right: 300, width: 300, height: 100, x: 0, y: tops[i], toJSON: () => ({}) })));
    const handle = within(row(1)).getByRole("button", { name: "Drag photo 1" });
    expect(handle.className).toContain("touch-none"); // a finger drags instead of scrolling the page
    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 260 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onMove).toHaveBeenCalledWith(0, 2);
  });

  it("a drag that is cancelled, or dropped where it started, moves nothing", () => {
    const { onMove } = show();
    const handle = within(row(2)).getByRole("button", { name: "Drag photo 2" });
    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("works out the row a pointer is over from the rows' boxes", () => {
    const boxes = [{ top: 0, bottom: 100 }, { top: 100, bottom: 200 }, { top: 200, bottom: 300 }];
    expect([-50, 10, 49, 51, 120, 160, 260, 999].map((y) => indexAt(boxes, y))).toEqual([0, 0, 0, 1, 1, 2, 2, 2]);
    expect(indexAt([], 10)).toBe(0);
  });

  it("removes a photo, with a button of 44 px at least that names the photo", () => {
    const { onRemove } = show();
    const remove = within(row(2)).getByRole("button", { name: "Remove photo 2" });
    expect(remove.className).toContain("size-11");
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("shows how far an upload is, that one is waiting, that one is done, and why one failed with a way to try again", () => {
    const { onRetry } = show({
      slots: [slot("a", { fresh: true, status: "uploading", percent: 40 }), slot("b", { fresh: true, status: "waiting" }), slot("c", { fresh: true, status: "done", percent: 100 }), slot("d", { fresh: true, status: "failed", error: "This photo is bigger than 5 MB." })],
    });
    const bar = within(row(1)).getByRole("progressbar");
    expect(bar).toHaveAttribute("value", "40");
    expect(within(row(1)).getByText("Uploading 40%")).toBeInTheDocument();
    expect(within(row(2)).getByText("Waiting")).toBeInTheDocument();
    expect(within(row(3)).getByText("Uploaded")).toBeInTheDocument();
    expect(within(row(4)).getByRole("alert")).toHaveTextContent("Not uploaded: This photo is bigger than 5 MB.");
    expect(within(row(1)).getByText("New")).toBeInTheDocument();
    fireEvent.click(within(row(4)).getByRole("button", { name: "Try this photo again" }));
    expect(onRetry).toHaveBeenCalledWith(3);
  });

  it("every control is off while a save is running", () => {
    show({ disabled: true });
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });
});
