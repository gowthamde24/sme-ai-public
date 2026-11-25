import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TakeOver } from "@/lib/take-over/types";

import { TakeOverSwitch } from "./TakeOverSwitch";

afterEach(cleanup);
const state = (enabled: boolean): TakeOver => ({ enabled, changedAt: null, announces: true });
const draw = (enabled: boolean) => render(<TakeOverSwitch initial={state(enabled)} canEdit change={vi.fn()} />);

describe("Listening in and taking over: the monitoring line (lawyer's opinion, 25 Nov 2026)", () => {
  it("says the greeting adds 'This call may be monitored' only while listening in is ON", () => {
    draw(true);
    expect(screen.getByText(/This call may be monitored/)).toBeTruthy();
  });
  it("says nothing about it while listening in is OFF", () => {
    draw(false);
    expect(screen.queryByText(/This call may be monitored/)).toBeNull();
  });
});
