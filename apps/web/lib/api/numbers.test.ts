import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => request(...a) }));

import { USAGE_VERSION, acceptUsage } from "./numbers";

const T = "55555555-5555-4555-8555-555555555555";
beforeEach(() => request.mockReset());

describe("How you will use this number: the acceptance is stored before the purchase (call-compliance.md)", () => {
  it("posts the version label to /numbers/usage-ack", async () => {
    request.mockResolvedValue({ accepted: true });
    await acceptUsage("tok", T);
    expect(request).toHaveBeenCalledWith(`/v1/tenants/${T}/numbers/usage-ack`, "tok", { method: "POST", body: JSON.stringify({ version: "2026-11" }) });
    expect(USAGE_VERSION).toBe("2026-11");
  });
});
