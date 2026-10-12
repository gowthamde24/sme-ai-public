import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const h = vi.hoisted(() => ({ hours: vi.fn(), items: vi.fn(), outbox: vi.fn(), members: vi.fn() }));
vi.mock("@/lib/api/visits", () => ({ getVisitSettings: (...a: unknown[]) => h.hours(...a) }));
vi.mock("@/lib/api/catalogue", () => ({ listCatalogueItems: (...a: unknown[]) => h.items(...a) }));
vi.mock("@/lib/api/outbox", () => ({ getOutboxSettings: (...a: unknown[]) => h.outbox(...a) }));
vi.mock("@/lib/api/orders", () => ({ fetchMembers: (...a: unknown[]) => h.members(...a) }));

import { readSetupFacts } from "./setup-data";

const T = "11111111-1111-4111-8111-111111111111";
const settings = { weekly_hours: {}, closed_dates: [], slot_minutes: 30, max_parallel: 2, is_default: true };

beforeEach(() => {
  h.hours.mockReset().mockResolvedValue(settings);
  h.items.mockReset().mockResolvedValue({ items: [], next_cursor: null });
  h.outbox.mockReset().mockResolvedValue({ platform_switch_on: true, auto_send_enabled: false, per_customer_daily_limit: 3, quiet_hours_start: 21, quiet_hours_end: 9 });
  h.members.mockReset().mockResolvedValue([{ user_id: "u" }]);
});

describe("readSetupFacts (job BJ): existing endpoints only, each read on its own", () => {
  it("reads the hours (and whether they are the business's own), the catalogue, the sending switch and the members, with the Owner's token", async () => {
    const f = await readSetupFacts("tok", T, "Asha Silks");
    expect(f).toEqual({ shop: "Asha Silks", hours: { settings, saved: false }, sarees: 0, sending: { auto: false, quietStart: 21, quietEnd: 9, platformOn: true }, members: 1 });
    expect(h.hours).toHaveBeenCalledWith("tok", T);
    expect(h.items).toHaveBeenCalledWith("tok", T, { limit: 1, includeInactive: true }); // a hidden saree counts too
    expect(h.outbox).toHaveBeenCalledWith("tok", T);
    expect(h.members).toHaveBeenCalledWith("tok", T);
  });
  it("hours the business saved are 'saved'; a catalogue with a saree counts it", async () => {
    h.hours.mockResolvedValue({ ...settings, is_default: false });
    h.items.mockResolvedValue({ items: [{ id: "x" }], next_cursor: null });
    const f = await readSetupFacts("tok", T, "S");
    expect(f.hours?.saved).toBe(true);
    expect(f.sarees).toBe(1);
  });
  it("a read that fails is unknown (null) and does not take the others down", async () => {
    h.hours.mockRejectedValue(new ApiRequestError(500, "x", "x"));
    h.items.mockRejectedValue(new Error("down"));
    const f = await readSetupFacts("tok", T, "S");
    expect(f.hours).toBeNull();
    expect(f.sarees).toBeNull();
    expect(f.sending).not.toBeNull();
    expect(f.members).toBe(1);
  });
  it("a rejected session is passed on (the page sends the person to sign in)", async () => {
    h.outbox.mockRejectedValue(new ApiAuthError("no"));
    await expect(readSetupFacts("tok", T, "S")).rejects.toBeInstanceOf(ApiAuthError);
  });
});
