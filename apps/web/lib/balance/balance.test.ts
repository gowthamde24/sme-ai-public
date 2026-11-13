import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { parseBalance, readBalance } from "./source";

const T = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BALANCE_SCREENS", "1");
});

describe("the rupee balance", () => {
  it("is shown in rupees made from the paise, never 'credits', and the API's own text is not trusted", () => {
    const b = parseBalance({ balance_paise: 155000, balance_text: "1550 credits", minutes_estimate: 310, plan_name: "Sales assistant", low: false, topup_available: true, free_start_left_paise: 0 });
    expect(b).toMatchObject({ paise: 155000, text: "₹1,550", minutesEstimate: 310, planName: "Sales assistant", low: false, topupAvailable: true });
    expect(JSON.stringify(b)).not.toMatch(/credit/i);
    expect(parseBalance({ balance_paise: 123456 })?.text).toBe("₹1,234.56");
  });
  it.each([[null], ["x"], [{}], [{ balance_paise: -1 }], [{ balance_paise: 1.5 }], [{ balance_paise: "5" }], [{ balance_paise: 1e15 }]])("%j is no balance", (v) => {
    expect(parseBalance(v)).toBeNull();
  });
  it("off: nothing and no request; mock: ₹1,550; on: the API; a failure: null", async () => {
    vi.stubEnv("BALANCE_SCREENS", "");
    expect(await readBalance("tok", T)).toBeNull();
    vi.stubEnv("BALANCE_SCREENS", "mock");
    expect((await readBalance("tok", T))?.text).toBe("₹1,550");
    expect(apiRequest).not.toHaveBeenCalled();
    vi.stubEnv("BALANCE_SCREENS", "1");
    apiRequest.mockResolvedValueOnce({ balance_paise: 4200 });
    expect((await readBalance("tok", T))?.text).toBe("₹42");
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/billing/balance`, "tok");
    apiRequest.mockRejectedValueOnce(new Error("down"));
    expect(await readBalance("tok", T)).toBeNull();
    expect(await readBalance("tok", "nope")).toBeNull();
  });
});
