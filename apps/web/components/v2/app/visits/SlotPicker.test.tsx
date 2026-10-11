import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { slotsJson } from "@/lib/api/visits-fixtures";

import { SlotPicker, type SlotChoice } from "./SlotPicker";
import { TODAY, WORDS } from "./visits-test-kit";

afterEach(cleanup);

function Harness({ load, start = { date: TODAY, slot: null } as SlotChoice, onPick }: { load: (d: string) => Promise<never>; start?: SlotChoice; onPick?: (v: SlotChoice) => void }) {
  const [v, setV] = React.useState(start);
  return <SlotPicker words={WORDS} lang="en" min={TODAY} value={v} onChange={(x) => (setV(x), onPick?.(x))} load={load as never} idPrefix="t" />;
}
const mount = async (load: (d: string) => Promise<unknown>, props: Partial<React.ComponentProps<typeof Harness>> = {}) => {
  await act(async () => void render(<Harness load={load as never} {...props} />));
};

describe("the day and time picker", () => {
  it("asks for the free times of the day and shows them, with the places left", async () => {
    const load = vi.fn(async (d: string) => ({ ok: true, slots: slotsJson(d, { "10:30": 1, "11:00": 0 }) }));
    await mount(load);
    expect(load).toHaveBeenCalledWith(TODAY);
    expect(screen.getByRole("button", { name: /^10:00\s*2 free$/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^10:30\s*1 free$/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^11:00\s*Full$/ })).toBeDisabled();
    expect(screen.getByText("Wednesday, 14 October 2026")).toBeInTheDocument();
  });
  it("choosing a time reports the day and the time, and marks it pressed", async () => {
    const onPick = vi.fn();
    await mount(async (d) => ({ ok: true, slots: slotsJson(d) }), { onPick });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^10:30/ })));
    expect(onPick).toHaveBeenLastCalledWith({ date: TODAY, slot: "10:30" });
    expect(screen.getByRole("button", { name: /^10:30/ })).toHaveAttribute("aria-pressed", "true");
  });
  it("changing the day asks for that day and forgets the time", async () => {
    const load = vi.fn(async (d: string) => ({ ok: true, slots: slotsJson(d) }));
    const onPick = vi.fn();
    await mount(load, { start: { date: TODAY, slot: "10:30" }, onPick });
    await act(async () => fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-10-16" } }));
    expect(load).toHaveBeenLastCalledWith("2026-10-16");
    expect(onPick).toHaveBeenLastCalledWith({ date: "2026-10-16", slot: null });
    expect(screen.getByText("Friday, 16 October 2026")).toBeInTheDocument();
  });
  it("does not ask twice for a day it already has", async () => {
    const load = vi.fn(async (d: string) => ({ ok: true, slots: slotsJson(d) }));
    await mount(load);
    await act(async () => fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-10-16" } }));
    await act(async () => fireEvent.change(screen.getByLabelText("Day"), { target: { value: TODAY } }));
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("an earlier slot of today can be chosen and says so", async () => {
    const earlier = { ...slotsJson(TODAY), slots: slotsJson(TODAY).slots.map((s, i) => ({ ...s, past: i === 0 })) };
    await mount(async () => ({ ok: true, slots: earlier }));
    expect(screen.getByRole("button", { name: /^10:00\s*Earlier today$/ })).toBeEnabled();
  });
  it("says why a day has no times: a closed date, the weekday, a day that has passed, or nothing", async () => {
    const closed = (reason: string | null) => async (d: string) => ({ ok: true, slots: { ...slotsJson(d), open: false, reason, slots: [] } });
    for (const [reason, text] of [["closed_date", "The shop is closed on this date."], ["past", "This day has already passed."], ["closed_weekday", "The shop is closed on this day of the week."], [null, "There are no visit times on this day."]] as const) {
      await mount(closed(reason));
      expect(screen.getByText(text)).toBeInTheDocument();
      cleanup();
    }
  });
  it("says so when the times cannot be loaded, and while they are being asked", async () => {
    await mount(async () => ({ ok: false, error: "x" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The times could not be loaded.");
    cleanup();
    await mount(async () => {
      throw new Error("boom");
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    cleanup();
    await act(async () => void render(<Harness load={(() => new Promise(() => {})) as never} />));
    expect(screen.getByRole("status")).toHaveTextContent("Looking for free times");
  });
  it("a day that is not a date asks for nothing", async () => {
    const load = vi.fn();
    await mount(load as never, { start: { date: "", slot: null } });
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByText("Pick a day first.")).toBeInTheDocument();
  });
  it("the times are at least 44 px high", async () => {
    await mount(async (d) => ({ ok: true, slots: slotsJson(d) }));
    expect(screen.getByRole("button", { name: /^10:00/ }).className).toContain("min-h-12");
  });
});
