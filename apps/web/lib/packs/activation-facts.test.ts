import { beforeEach, describe, expect, it, vi } from "vitest";

const summarySetup = vi.fn();
const getProfile = vi.fn();
const getAccountSecurity = vi.fn();
const getWhatsappAccount = vi.fn();
vi.mock("@/lib/api/today-summary", () => ({ summarySetup: (...a: unknown[]) => summarySetup(...a) }));
vi.mock("@/lib/api/profile", () => ({ getProfile: (...a: unknown[]) => getProfile(...a) }));
vi.mock("@/lib/api/pack", () => ({ getAccountSecurity: (...a: unknown[]) => getAccountSecurity(...a) }));
vi.mock("@/lib/api/whatsapp", () => ({ getWhatsappAccount: (...a: unknown[]) => getWhatsappAccount(...a) }));

import { readFacts } from "./activation-facts";

const T = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  summarySetup.mockResolvedValue(undefined);
  getProfile.mockResolvedValue({ town: "Dharmavaram" });
  getAccountSecurity.mockResolvedValue({ secondFactorOn: true, level: "aal1" });
  getWhatsappAccount.mockResolvedValue({ configured: true, status: "active" });
});

describe("readFacts: the checklist's facts", () => {
  it("without the Today summary every fact is read from its own route, as before", async () => {
    expect(await readFacts("tok", T, ["business_profile", "second_factor_set", "whatsapp_connected"])).toEqual({ business_profile: true, second_factor_set: true, whatsapp_connected: true });
    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(getAccountSecurity).toHaveBeenCalledTimes(1);
    expect(getWhatsappAccount).toHaveBeenCalledTimes(1);
  });
  it("a fact the summary's setup_progress holds is used and its route is NOT read; one it does not hold (a failed read there) is read on its own", async () => {
    summarySetup.mockResolvedValue({ business_profile: true, second_factor_set: false });
    const facts = await readFacts("tok", T, ["business_profile", "second_factor_set", "whatsapp_connected"]);
    expect(facts).toEqual({ business_profile: true, second_factor_set: false, whatsapp_connected: true });
    expect(getProfile).not.toHaveBeenCalled();
    expect(getAccountSecurity).not.toHaveBeenCalled();
    expect(getWhatsappAccount).toHaveBeenCalledTimes(1);
  });
  it("a check nobody asks for is not read, in either way", async () => {
    summarySetup.mockResolvedValue({ business_profile: true, whatsapp_connected: true });
    expect(await readFacts("tok", T, ["business_profile"])).toEqual({ business_profile: true });
    expect(getWhatsappAccount).not.toHaveBeenCalled();
  });
  it("a fact that cannot be read is not done (never a guess), and a summary that fails is the old path", async () => {
    summarySetup.mockRejectedValue(new Error("summary down"));
    getProfile.mockRejectedValue(new Error("down"));
    expect(await readFacts("tok", T, ["business_profile", "second_factor_set"])).toEqual({ business_profile: false, second_factor_set: true });
  });
});
