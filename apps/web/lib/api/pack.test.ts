import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPackId, modulesWire, otherPackIds, packFiles, packsWire, packWire, selectableIds } from "@/lib/packs/pack-test-kit";

import { ApiAuthError, ApiContractError, ApiRequestError } from "./client";

const apiRequest = vi.fn();
const apiPublicRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a), apiPublicRequest: (...a: unknown[]) => apiPublicRequest(...a) }));

import { getAccountSecurity, getAuthProviders, getWorkspacePack, listPacks, moduleOn, parseEnabledModules, parsePackSummary, parseWorkspacePack, parseWords } from "./pack";

const T = "22222222-2222-4222-8222-222222222222";
beforeEach(() => vi.resetAllMocks());

describe("the business types a new person may choose (GET /v1/packs)", () => {
  it("reads the cards the API offers, with the names in every language and the accent and owl prop tokens", async () => {
    apiPublicRequest.mockResolvedValue(packsWire());
    const packs = await listPacks();
    expect(apiPublicRequest).toHaveBeenCalledWith("/v1/packs");
    expect(packs.map((p) => p.packId)).toEqual(selectableIds());
    expect(packs[0].validated).toBe(true); // the reviewed type comes first
    for (const p of packs) expect(p).toMatchObject({ names: { en: expect.any(String), te: expect.any(String) }, accent: expect.stringMatching(/^[a-z_]+$/), owlProp: expect.stringMatching(/^[a-z_]+$/) });
    expect(packs.find((p) => p.packId === defaultPackId())?.validated).toBe(true);
  });
  it.each([[null], [{}], [{ packs: [] }], [{ packs: [{ pack_id: "Bad Id" }] }], [{ packs: [{ ...packsWire().packs[0], status: "live" }] }], [{ packs: [{ ...packsWire().packs[0], names: { te: "x" } }] }], [{ packs: [{ ...packsWire().packs[0], validated: "yes" }] }]])("%j is a contract error, never a card", async (body) => {
    apiPublicRequest.mockResolvedValue(body);
    await expect(listPacks()).rejects.toThrow(ApiContractError);
  });
  it("keeps only the languages the product has", () => {
    expect(parseWords({ en: "a", te: "b", xx: "c" }, "w")).toEqual({ en: "a", te: "b" });
    expect(() => parseWords({ en: "" }, "w")).toThrow(ApiContractError);
    expect(() => parseWords({ en: "a", hi: 4 }, "w")).toThrow(ApiContractError);
    expect(parsePackSummary(packsWire().packs[0]).packId).toBe(packsWire().packs[0].pack_id);
  });
});

describe("which ways to sign up are on (GET /v1/auth/providers)", () => {
  it("offers Google and Facebook only when the server says so", async () => {
    apiPublicRequest.mockResolvedValue({ email: true, google: true, facebook: false });
    expect(await getAuthProviders()).toEqual({ google: true, facebook: false });
  });
  it("counts anything unreadable, or a failed call, as off: e-mail is always there", async () => {
    for (const answer of [null, "x", { google: "yes", facebook: 1 }]) {
      apiPublicRequest.mockResolvedValueOnce(answer);
      expect(await getAuthProviders()).toEqual({ google: false, facebook: false });
    }
    apiPublicRequest.mockRejectedValueOnce(new ApiRequestError(503, "api_unreachable", "x"));
    expect(await getAuthProviders()).toEqual({ google: false, facebook: false });
  });
});

describe("where the session stands on the second factor (GET /v1/account/security)", () => {
  it("reads the level and the groups of actions that need one", async () => {
    apiRequest.mockResolvedValue({ session_level: "aal1", asked_at_sign_up: false, needed_for: ["approvals", "whatsapp_connect"] });
    expect(await getAccountSecurity("tok")).toEqual({ level: "aal1", neededFor: ["approvals", "whatsapp_connect"] });
    expect(apiRequest).toHaveBeenCalledWith("/v1/account/security", "tok");
  });
  it("is null for a server without the route or an unreadable answer; a rejected session is passed on", async () => {
    apiRequest.mockResolvedValueOnce({ session_level: "aal3", needed_for: [] });
    expect(await getAccountSecurity("tok")).toBeNull();
    apiRequest.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await getAccountSecurity("tok")).toBeNull();
    apiRequest.mockRejectedValueOnce(new ApiAuthError("no"));
    await expect(getAccountSecurity("tok")).rejects.toBeInstanceOf(ApiAuthError);
  });
});

const workspacePackHas = (id: string) => Object.values(packFiles()[id].example_data ?? {}).some((rows) => Array.isArray(rows) && rows.length > 0);

describe("the business type of a workspace (GET .../pack and .../modules)", () => {
  const other = otherPackIds()[0];
  const answer = (path: string, id: string, source: "signup" | "default" | "legacy" = "signup", enabled?: string[]) => (path.endsWith("/pack") ? packWire(id, source) : modulesWire(enabled ?? packFiles()[id].modules));
  it("reads the pack, its words by language and the modules that are ON (the modules answer wins)", async () => {
    const enabled = packFiles()[other].modules.filter((m) => m !== "campaigns");
    apiRequest.mockImplementation(async (path: string) => answer(path, other, "signup", enabled));
    const p = (await getWorkspacePack("tok", T))!;
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/pack`, "tok");
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/modules`, "tok");
    expect(p).toMatchObject({ packId: other, source: "signup", coreTab: packFiles()[other].core_tab });
    expect(p.modules).toEqual(enabled);
    expect(p.modules).not.toContain("campaigns");
    expect(p.labels.en["pack.core_tab"]).toBe(packFiles()[other].labels.en["pack.core_tab"]);
    expect(Object.keys(p.labels)).toEqual(expect.arrayContaining(["en", "te", "hi", "kn"]));
  });
  it("says whether the pack ships example data, and takes a server that does not say as yes", () => {
    const withData = selectableIds().find((i) => workspacePackHas(i));
    const without = selectableIds().find((i) => !workspacePackHas(i));
    expect(parseWorkspacePack(packWire(withData!, "signup")).hasExampleData).toBe(true);
    expect(parseWorkspacePack(packWire(without!, "signup")).hasExampleData).toBe(false);
    const old = Object.fromEntries(Object.entries(packWire(without!, "signup")).filter(([k]) => k !== "has_example_data"));
    expect(parseWorkspacePack(old).hasExampleData).toBe(true);
  });
  it("uses the pack's own list when only the modules read fails", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path.endsWith("/modules")) throw new ApiRequestError(500, "internal", "x");
      return answer(path, other);
    });
    expect((await getWorkspacePack("tok", T))!.modules).toEqual(packFiles()[other].modules);
  });
  it("is null for a server without the pack routes (404, 501, 503 packs_unavailable): the product as it always was", async () => {
    for (const e of [new ApiRequestError(404, "not_found", "x"), new ApiRequestError(501, "not_implemented", "x"), new ApiRequestError(503, "packs_unavailable", "x")]) {
      apiRequest.mockReset();
      apiRequest.mockRejectedValue(e);
      expect(await getWorkspacePack("tok", T)).toBeNull();
    }
  });
  it("raises a real failure and passes a rejected session on", async () => {
    apiRequest.mockRejectedValue(new ApiRequestError(500, "internal", "x"));
    await expect(getWorkspacePack("tok", T)).rejects.toBeInstanceOf(ApiRequestError);
    apiRequest.mockReset();
    apiRequest.mockRejectedValue(new ApiAuthError("no"));
    await expect(getWorkspacePack("tok", T)).rejects.toBeInstanceOf(ApiAuthError);
  });
  it("validates every field: a malformed answer is an error, never rendered", () => {
    const good = packWire(other, "signup");
    for (const bad of [null, [], { ...good, source: "magic" }, { ...good, modules: "all" }, { ...good, core_tab: "Bad Tab" }, { ...good, units: [1] }, { ...good, labels: {} }, { ...good, labels: { en: { "bad key": "x" } } }, { ...good, labels: { en: { "nav.item.today": "" } } }, { ...good, version: 0 }]) {
      expect(() => parseWorkspacePack(bad), JSON.stringify(bad)?.slice(0, 80)).toThrow(ApiContractError);
    }
    expect(() => parseEnabledModules({ modules: [{ module: "today", enabled: "yes" }] })).toThrow(ApiContractError);
    expect(parseEnabledModules(modulesWire(["today", "inbox"]))).toEqual(["today", "inbox"]);
  });
  it("ignores a language this build does not have, and an unknown module simply is not drawn", () => {
    const p = parseWorkspacePack({ ...packWire(other), labels: { ...(packWire(other).labels as Record<string, unknown>), ta: { "nav.item.today": "x" } } });
    expect(Object.keys(p.labels)).not.toContain("ta");
  });
  it("moduleOn: with no pack everything is on; with one only its modules", () => {
    expect(moduleOn(null, "anything")).toBe(true);
    expect(moduleOn({ modules: ["today"] }, "today")).toBe(true);
    expect(moduleOn({ modules: ["today"] }, "fees")).toBe(false);
  });
});
