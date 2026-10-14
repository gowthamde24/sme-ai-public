import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiContractError, ApiRequestError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { fixtureWorkspacePack, getWorkspacePack, moduleOn, parseField, parseWorkspacePack } from "./pack";

const T = "22222222-2222-4222-8222-222222222222";
beforeEach(() => vi.clearAllMocks());

describe("the pack of a workspace", () => {
  it("needs only the pack code: the words, modules and fields of that pack come from its file", () => {
    const p = parseWorkspacePack({ pack: "construction" });
    expect(p.def.id).toBe("construction");
    expect(p.source).toBe("api");
    expect(p.version).toBe(p.def.version);
    expect(p.modules).toEqual(p.def.modules);
    expect(p.fields.map((f) => `${f.entity}.${f.code}`)).toContain("catalogue_item.selling_unit");
    expect(p.fields.every((f) => f.source === "pack" && f.active && f.id === null)).toBe(true);
    expect(p.example).toBe("none");
  });
  it("lets the API's module list win over the file's (pack default AND plan AND operator override), dropping a name this build does not know", () => {
    const p = parseWorkspacePack({ pack: "construction", modules: ["today", "orders", "a_module_from_the_future"] });
    expect(p.modules).toEqual(["today", "orders"]);
    expect(moduleOn(p, "orders")).toBe(true);
    expect(moduleOn(p, "quotes")).toBe(false); // default deny
  });
  it("draws a pack code this build does not know with the default pack's words, but keeps the modules the API sent", () => {
    const p = parseWorkspacePack({ pack: "hospitality", modules: ["today", "fees"] });
    expect(p.def.default).toBe(true);
    expect(p.modules).toEqual(["today", "fees"]);
  });
  it("reads the workspace's fields: the pack's and the owner's own, with their ids, a plain-string label and the active flag", () => {
    const p = parseWorkspacePack({
      pack: "construction",
      fields: [
        { id: "f1", entity: "contact", code: "gate_code", kind: "text", label: "Gate code", required: false, pii_class: "none", source: "owner", active: false },
        { entity: "contact", code: "customer_type", kind: "choice", label: { en: "Customer type", hi: "ग्राहक" }, pii_class: "none", choices: [{ code: "builder", label: "Builder" }, { code: "dealer", label: { en: "Dealer" } }] },
      ],
      example_data: { available: true, loaded: false },
    });
    expect(p.fields[0]).toMatchObject({ id: "f1", source: "owner", active: false, label: { en: "Gate code", te: "Gate code", hi: "Gate code", kn: "Gate code" } });
    expect(p.fields[1].label).toMatchObject({ en: "Customer type", hi: "ग्राहक", te: "Customer type" }); // a missing language falls back to English
    expect(p.fields[1].choices?.map((c) => c.code)).toEqual(["builder", "dealer"]);
    expect(p.example).toBe("available");
    expect(parseWorkspacePack({ pack: "education", example_data: { available: true, loaded: true } }).example).toBe("loaded");
  });
  it.each([
    [null], ["x"], [[]], [{}], [{ pack: 3 }], [{ pack: "x".repeat(41) }],
    [{ pack: "construction", modules: "today" }], [{ pack: "construction", modules: [1] }], [{ pack: "construction", fields: "no" }],
    [{ pack: "construction", fields: [{ entity: "order", code: "ab", kind: "text", label: "x", pii_class: "none" }] }],
    [{ pack: "construction", fields: [{ entity: "contact", code: "Bad Code", kind: "text", label: "x", pii_class: "none" }] }],
    [{ pack: "construction", fields: [{ entity: "contact", code: "ab", kind: "color", label: "x", pii_class: "none" }] }],
    [{ pack: "construction", fields: [{ entity: "contact", code: "ab", kind: "text", label: "x", pii_class: "secret" }] }],
    [{ pack: "construction", fields: [{ entity: "contact", code: "ab", kind: "choice", label: "x", pii_class: "none" }] }],
    [{ pack: "construction", fields: [{ entity: "contact", code: "ab", kind: "text", label: "x", pii_class: "none", choices: [] }] }],
    [{ pack: "construction", fields: [{ entity: "contact", code: "ab", kind: "text", label: "", pii_class: "none" }] }],
  ])("%j is a contract error", (json) => {
    expect(() => parseWorkspacePack(json)).toThrow(ApiContractError);
  });
  it("parses one field on its own (used by the add and hide calls)", () => {
    expect(parseField({ id: "x1", entity: "catalogue_item", code: "weight", kind: "number", label: "Weight", unit: "kg", pii_class: "none", source: "owner" })).toMatchObject({ id: "x1", unit: "kg", required: false, active: true });
    expect(() => parseField({ id: 12, entity: "contact", code: "ab", kind: "text", label: "x", pii_class: "none" })).toThrow(ApiContractError);
    expect(() => parseField({ entity: "contact", code: "ab", kind: "text", label: "x", pii_class: "none", source: "someone" })).toThrow(ApiContractError);
    expect(() => parseField({ entity: "contact", code: "ab", kind: "text", label: "x", pii_class: "none", active: "yes" })).toThrow(ApiContractError);
  });
  it("is read with the person's token from the workspace's own path", async () => {
    apiRequest.mockResolvedValue({ pack: "education" });
    expect((await getWorkspacePack("tok", T)).def.id).toBe("education");
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/pack`, "tok");
  });
  it("stands in with the default pack's file while the route does not exist (404 or 501), and says it is a stand-in", async () => {
    for (const status of [404, 501]) {
      apiRequest.mockRejectedValueOnce(new ApiRequestError(status, "not_found", "x"));
      const p = await getWorkspacePack("tok", T);
      expect(p).toEqual(fixtureWorkspacePack());
      expect(p.source).toBe("fixture");
      expect(p.def.default).toBe(true);
      expect(p.example).toBe("none");
    }
  });
  it("does not hide a real failure behind the stand-in: a server error, a bad answer and a rejected session are raised", async () => {
    apiRequest.mockRejectedValueOnce(new ApiRequestError(500, "internal", "x"));
    await expect(getWorkspacePack("tok", T)).rejects.toThrow(ApiRequestError);
    apiRequest.mockResolvedValueOnce({ pack: 7 });
    await expect(getWorkspacePack("tok", T)).rejects.toThrow(ApiContractError);
    apiRequest.mockRejectedValueOnce(new ApiAuthError("no"));
    await expect(getWorkspacePack("tok", T)).rejects.toThrow(ApiAuthError);
  });
});
