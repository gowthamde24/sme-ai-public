import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KEEP_RECORD_KEY, resetKeepRecordMemory, useKeepRecord } from "./use-keep-record";

function Box() {
  const [keep, set] = useKeepRecord();
  return (
    <label>
      <input type="checkbox" checked={keep} onChange={(e) => set(e.target.checked)} />
      keep
    </label>
  );
}

beforeEach(() => {
  resetKeepRecordMemory();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Keep a record of this: remembered on the device", () => {
  it("is ticked by default", () => {
    render(<Box />);
    expect(screen.getByRole("checkbox", { name: "keep" })).toBeChecked();
  });
  it("unticking it is remembered, in one key, as the plain text 0", () => {
    render(<Box />);
    fireEvent.click(screen.getByRole("checkbox", { name: "keep" }));
    expect(screen.getByRole("checkbox", { name: "keep" })).not.toBeChecked();
    expect(window.localStorage.getItem(KEEP_RECORD_KEY)).toBe("0");
    expect(window.localStorage.length).toBe(1);
  });
  it("a later visit starts as the person left it", () => {
    window.localStorage.setItem(KEEP_RECORD_KEY, "0");
    render(<Box />);
    expect(screen.getByRole("checkbox", { name: "keep" })).not.toBeChecked();
    cleanup();
    resetKeepRecordMemory();
    window.localStorage.setItem(KEEP_RECORD_KEY, "1");
    render(<Box />);
    expect(screen.getByRole("checkbox", { name: "keep" })).toBeChecked();
  });
  it("anything but 0 in storage is ticked (a damaged value does not turn records off)", () => {
    window.localStorage.setItem(KEEP_RECORD_KEY, "garbage");
    render(<Box />);
    expect(screen.getByRole("checkbox", { name: "keep" })).toBeChecked();
  });
  it("two boxes on the page agree", () => {
    render(
      <>
        <Box />
        <Box />
      </>,
    );
    const [a, b] = screen.getAllByRole("checkbox");
    fireEvent.click(a);
    expect(b).not.toBeChecked();
  });
  it("storage that throws when read is not an error: ticked, and the choice still works for this visit", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Box />);
    expect(screen.getByRole("checkbox", { name: "keep" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "keep" }));
    expect(screen.getByRole("checkbox", { name: "keep" })).not.toBeChecked();
  });
  it("storage that throws when written is not an error either: the choice lives for this visit", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    render(<Box />);
    fireEvent.click(screen.getByRole("checkbox", { name: "keep" }));
    expect(screen.getByRole("checkbox", { name: "keep" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "keep" }));
    expect(screen.getByRole("checkbox", { name: "keep" })).toBeChecked();
  });
  it("a choice made in another tab arrives here", () => {
    render(<Box />);
    window.localStorage.setItem(KEEP_RECORD_KEY, "0");
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: KEEP_RECORD_KEY, newValue: "0" })));
    expect(screen.getByRole("checkbox", { name: "keep" })).not.toBeChecked();
  });
});
