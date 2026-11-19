import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => request(...a) }));

import { ApiRequestError } from "@/lib/api/client";
import { connectCard, metaConnect, sourceErrorOf } from "@/lib/api/source-cards";

import { liveApi } from "./server";

const T = "55555555-5555-4555-8555-555555555555";
beforeEach(() => request.mockReset());

describe("the consent tick reaches the API (JOBS)", () => {
  it("a Facebook connect with the tick sends consent_confirmed: true; without it the body is empty as before", async () => {
    request.mockResolvedValue({ authorize_url: "https://www.facebook.com/dialog/oauth?x=1" });
    await metaConnect("tok", T, true);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/lead-sources/meta/connect`, "tok", { method: "POST", body: JSON.stringify({ consent_confirmed: true }) });
    await metaConnect("tok", T);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/lead-sources/meta/connect`, "tok", { method: "POST", body: JSON.stringify({}) });
  });
  it("the website form connect: the same", async () => {
    request.mockResolvedValue(null);
    await connectCard("tok", T, "website", true);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/lead-sources/cards/website/connect`, "tok", { method: "POST", body: JSON.stringify({ consent_confirmed: true }) });
    await connectCard("tok", T, "website");
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/lead-sources/cards/website/connect`, "tok", { method: "POST", body: JSON.stringify({}) });
  });
  it("the live door passes the tick on, and the API's 422 consent_required is a closed word of its own", async () => {
    request.mockRejectedValueOnce(new ApiRequestError(422, "consent_required", "x"));
    const r = await liveApi("tok", T).connect("website", true);
    expect(r).toEqual({ ok: false, error: "consent_required" });
    expect(request.mock.calls[0][2]).toEqual({ method: "POST", body: JSON.stringify({ consent_confirmed: true }) });
    expect(sourceErrorOf(new ApiRequestError(422, "consent_required", "x"))).toBe("consent_required");
    expect(sourceErrorOf(new ApiRequestError(422, "other", "x"))).toBe("down");
  });
});
