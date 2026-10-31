import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/tenants/11111111-1111-4111-8111-111111111111", useSearchParams: () => new URLSearchParams() }));

import { NO_FRAME_DATA, type FrameData } from "./contract";
import { UsageBanner } from "./UsageBanner";
import type { Membership } from "./use-workspace";

const T = "11111111-1111-4111-8111-111111111111";
const memberships = [{ id: T, name: "Acme", role: "owner" } as Membership];
const usage = (over: Partial<NonNullable<FrameData["usage"]>> = {}): NonNullable<FrameData["usage"]> => ({ today_percent: 40, month_percent: 20, resets_at_today: "2026-10-31T18:30:00Z", resets_at_month: "2026-11-30T18:30:00Z", state: "ok", ...over });
const show = (over: Partial<FrameData>) => render(<UsageBanner memberships={memberships} frame={{ ...NO_FRAME_DATA, ...over }} />);
afterEach(cleanup);

describe("the usage banner", () => {
  it("is not there below 90 %, with no usage, or for a role the API gives no usage to", () => {
    show({ usage: usage({ today_percent: 89, month_percent: 10 }) });
    expect(document.querySelector('[data-frame="usage-banner"]')).toBeNull();
    cleanup();
    show({ usage: null });
    expect(document.querySelector('[data-frame="usage-banner"]')).toBeNull();
    cleanup();
    show({ usage: usage({ today_percent: 95 }), showUsage: false });
    expect(document.querySelector('[data-frame="usage-banner"]')).toBeNull();
  });
  it("from 90 % of today's allowance it says so, with the way to Settings, Plan and usage", () => {
    show({ usage: usage({ today_percent: 92, month_percent: 30, state: "warn" }) });
    expect(screen.getByRole("status")).toHaveTextContent("Your assistant has used 92% of today's allowance.");
    expect(screen.getByRole("link", { name: "See usage" })).toHaveAttribute("href", `/app/tenants/${T}/settings?section=plan`);
  });
  it("names the month when that is the fuller window, and says so in the lighter mode and when paused, whatever the percent", () => {
    show({ usage: usage({ today_percent: 20, month_percent: 94, state: "warn" }) });
    expect(screen.getByRole("status")).toHaveTextContent("94% of this month's allowance");
    cleanup();
    show({ usage: usage({ today_percent: 100, state: "light" }) });
    expect(screen.getByRole("status")).toHaveTextContent(/Light mode until/);
    cleanup();
    show({ usage: usage({ today_percent: 100, state: "paused" }) });
    expect(screen.getByRole("status")).toHaveTextContent(/paused/i);
  });
});
