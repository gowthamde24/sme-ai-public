import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { acceptPolicies, getPolicyStatus, parsePolicyStatus } from "./policy";

const STATUS = { current: { terms: { version: "2026-11-01", effective_from: "2026-11-10" }, privacy: { version: "2026-10-01" } }, accepted: [{ kind: "privacy", version: "2026-10-01", accepted_at: "2026-10-02T10:00:00Z", via: "setup" }], needs_acceptance: { terms: true, privacy: false }, blocking: true };
beforeEach(() => vi.clearAllMocks());

describe("the policies a person accepted", () => {
  it("reads the current versions, what was accepted and what is needed", async () => {
    apiRequest.mockResolvedValue(STATUS);
    const s = await getPolicyStatus("tok");
    expect(s.current.terms).toEqual({ version: "2026-11-01", effective_from: "2026-11-10" });
    expect(s.current.privacy.effective_from).toBeNull();
    expect(s.needs).toEqual({ terms: true, privacy: false });
    expect(s.blocking).toBe(true);
    expect(apiRequest).toHaveBeenCalledWith("/v1/me/policy-acceptances", "tok");
  });
  it("an answer from before 'blocking' existed reads as not blocking", () => {
    const { blocking: _b, ...old } = STATUS;
    void _b;
    expect(parsePolicyStatus(old).blocking).toBe(false);
  });
  it("sends only the versions that were shown", async () => {
    apiRequest.mockResolvedValue(STATUS);
    await acceptPolicies("tok", { terms: "2026-11-01" });
    expect(apiRequest).toHaveBeenCalledWith("/v1/me/policy-acceptances", "tok", { method: "POST", body: JSON.stringify({ terms_version: "2026-11-01" }) });
    await acceptPolicies("tok", { terms: "a", privacy: "b" });
    expect(apiRequest).toHaveBeenLastCalledWith("/v1/me/policy-acceptances", "tok", { method: "POST", body: JSON.stringify({ terms_version: "a", privacy_version: "b" }) });
  });
  it("refuses to accept nothing, and a kind we do not know", async () => {
    await expect(acceptPolicies("tok", {})).rejects.toThrow(ApiContractError);
    expect(() => parsePolicyStatus({ ...STATUS, accepted: [{ kind: "cookies", version: "1", accepted_at: "2026-10-02T10:00:00Z" }] })).toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe("the versions in force (job CF)", () => {
  it("are read from the public route", async () => {
    const { parseCurrentPolicies } = await import("./policy");
    expect(parseCurrentPolicies({ terms: { version: "2026-11-01", effective_from: "2026-11-10" }, privacy: { version: "2026-10-01" } })).toEqual({ terms: "2026-11-01", privacy: "2026-10-01" });
  });
  it("a version the API would refuse is a contract error", async () => {
    const { parseCurrentPolicies } = await import("./policy");
    expect(() => parseCurrentPolicies({ terms: { version: "a b" }, privacy: { version: "2026-10-01" } })).toThrow(ApiContractError);
  });
});
