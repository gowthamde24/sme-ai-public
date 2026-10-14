import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { packFields, packWithFields } from "@/lib/packs/pack-test-kit";
import { redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const createField = vi.fn();
const setActive = vi.fn();
const updateField = vi.fn();
const listFields = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/custom-fields", () => ({ createCustomField: (...a: unknown[]) => createField(...a), setCustomFieldActive: (...a: unknown[]) => setActive(...a), updateCustomField: (...a: unknown[]) => updateField(...a), listCustomFields: (...a: unknown[]) => listFields(...a) }));

vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "te" }));

import { addFieldAction, setFieldActiveAction, updateFieldAction } from "./field-actions";

const T = "22222222-2222-2222-2222-222222222222";
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const note = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (e) {
    const to = (e as { to?: string }).to ?? String(e);
    return to.startsWith(`/app/tenants/${T}/settings?section=fields&fieldnote=`) ? to.split("fieldnote=")[1] : to;
  }
  return null;
};
const PACK_FIELDS = packFields(packWithFields("contact", 1));
const NEW = { entity: "contact", label: "Gate code", kind: "text" };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: T, role: "owner" });
  listFields.mockResolvedValue(PACK_FIELDS);
  createField.mockResolvedValue({});
  setActive.mockResolvedValue({});
  updateField.mockResolvedValue({});
});

describe("adding a field", () => {
  it("makes the code from the words, sends the label, the kind and 'required', and says 'added'", async () => {
    expect(await note(() => addFieldAction(T, form({ ...NEW, required: "on" })))).toBe("added");
    expect(createField).toHaveBeenCalledWith("tok", T, { entity: "contact", code: "gate_code", kind: "text", label: "Gate code", required: true });
  });
  it("turns one choice per line into choices (two at least)", async () => {
    expect(await note(() => addFieldAction(T, form({ entity: "catalogue_item", label: "Size class", kind: "choice", choices: "Small\nLarge" })))).toBe("added");
    expect(createField.mock.calls[0][2].choices).toEqual([{ code: "small", label: "Small" }, { code: "large", label: "Large" }]);
    expect(await note(() => addFieldAction(T, form({ entity: "contact", label: "Tier", kind: "choice", choices: "Only one" })))).toBe("invalid");
  });
  it("is for the Owner and an Admin; a Sales person or a Viewer never reaches the API", async () => {
    for (const role of ["sales", "viewer"]) {
      fetchTenant.mockResolvedValue({ id: T, role });
      expect(await note(() => addFieldAction(T, form(NEW))), role).toBe("role");
    }
    fetchTenant.mockResolvedValue({ id: T, role: "admin" });
    expect(await note(() => addFieldAction(T, form(NEW)))).toBe("added");
    expect(createField).toHaveBeenCalledTimes(1);
  });
  it("refuses a kind, a record type or a label it does not know, without asking the API", async () => {
    for (const bad of [{ ...NEW, kind: "multi_choice" }, { ...NEW, kind: "colour" }, { ...NEW, entity: "order" }, { ...NEW, label: "" }, { ...NEW, label: "x".repeat(61) }]) expect(await note(() => addFieldAction(T, form(bad))), JSON.stringify(bad)).toBe("invalid");
    expect(createField).not.toHaveBeenCalled();
  });
  it("says 'not saved yet' while the server cannot list or keep fields (a server without the routes), and never pretends", async () => {
    listFields.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    expect(await note(() => addFieldAction(T, form(NEW)))).toBe("unavailable");
    expect(createField).not.toHaveBeenCalled();
    listFields.mockRejectedValue(new ApiAuthError("x"));
    expect(await note(() => addFieldAction(T, form(NEW)))).toBe("/login");
  });
  it("stops at 20 fields for one kind of record", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...PACK_FIELDS[0], id: `f${i}`, entity: "contact" as const, code: `field_${i}x`, kind: "text" as const, choices: null, active: true }));
    listFields.mockResolvedValue(many);
    expect(await note(() => addFieldAction(T, form(NEW)))).toBe("limit");
    expect(createField).not.toHaveBeenCalled();
  });
  it("keeps a code unique when the words give one the workspace already has", async () => {
    const taken = PACK_FIELDS.find((f) => f.entity === "contact")!;
    expect(await note(() => addFieldAction(T, form({ entity: "contact", label: taken.label.en, kind: "text" })))).toBe("added");
    expect(createField.mock.calls[0][2].code).not.toBe(taken.code);
  });
  it("tells the person why the API said no: the second factor, the role, a bad value, a missing route, anything else", async () => {
    createField.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await note(() => addFieldAction(T, form(NEW)))).toBe("mfa");
    createField.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect(await note(() => addFieldAction(T, form(NEW)))).toBe("role");
    createField.mockRejectedValueOnce(new ApiRequestError(409, "duplicate_value", "x"));
    expect(await note(() => addFieldAction(T, form(NEW)))).toBe("invalid");
    createField.mockRejectedValueOnce(new ApiRequestError(409, "custom_field_limit", "x"));
    expect(await note(() => addFieldAction(T, form(NEW)))).toBe("limit");
    createField.mockRejectedValueOnce(new ApiRequestError(403, "module_off", "x"));
    expect(await note(() => addFieldAction(T, form(NEW)))).toBe("unavailable");
    createField.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await note(() => addFieldAction(T, form(NEW)))).toBe("unavailable");
    createField.mockRejectedValueOnce(new ApiRequestError(500, "x", "x"));
    expect(await note(() => addFieldAction(T, form(NEW)))).toBe("failed");
    createField.mockRejectedValueOnce(new ApiAuthError("x"));
    expect(await note(() => addFieldAction(T, form(NEW)))).toBe("/login");
  });
});

describe("hiding and showing a field", () => {
  it("sends the new state of the field and says 'updated'", async () => {
    expect(await note(() => setFieldActiveAction(T, form({ field_id: "f1", active: "no" })))).toBe("updated");
    expect(setActive).toHaveBeenCalledWith("tok", T, "f1", false);
    await note(() => setFieldActiveAction(T, form({ field_id: "f1", active: "yes" })));
    expect(setActive).toHaveBeenLastCalledWith("tok", T, "f1", true);
  });
  it("is for the Owner and an Admin only, and needs a field id", async () => {
    fetchTenant.mockResolvedValue({ id: T, role: "sales" });
    expect(await note(() => setFieldActiveAction(T, form({ field_id: "f1", active: "no" })))).toBe("role");
    fetchTenant.mockResolvedValue({ id: T, role: "owner" });
    expect(await note(() => setFieldActiveAction(T, form({ active: "no" })))).toBe("invalid");
    expect(setActive).not.toHaveBeenCalled();
  });
});

describe("changing a field", () => {
  const choice = () => PACK_FIELDS.find((f) => f.kind === "choice")!;
  it("sends the new words for the language the person reads (the others stay), 'required', and only the choices that are new", async () => {
    const f = choice();
    expect(await note(() => updateFieldAction(T, form({ field_id: f.id, label: " Kind of customer ", required: "on", choices: `${f.choices![0].label.en}\nA brand new one\n\nA brand new one` })))).toBe("updated");
    const [token, tenant, id, patch] = updateField.mock.calls[0];
    expect([token, tenant, id]).toEqual(["tok", T, f.id]);
    expect(patch.label).toEqual({ ...f.label, te: "Kind of customer" });
    expect(patch.required).toBe(true);
    expect(patch.addChoices).toEqual([{ code: "a_brand_new_one", label: "A brand new one" }]); // the choice it has already is not sent again
  });
  it("turns 'required' off when the box is not ticked, and sends no choices for a field that has none", async () => {
    const text = PACK_FIELDS.find((f) => f.kind !== "choice" && f.kind !== "multi_choice") ?? { ...choice(), kind: "text" as const, choices: null, id: "t1" };
    listFields.mockResolvedValue([text]);
    expect(await note(() => updateFieldAction(T, form({ field_id: text.id, label: "Name", choices: "ignored" })))).toBe("updated");
    expect(updateField.mock.calls[0][3]).toMatchObject({ required: false, addChoices: [] });
  });
  it("is for the Owner and an Admin only, needs an id and a name, and refuses a field the workspace does not have", async () => {
    fetchTenant.mockResolvedValue({ id: T, role: "sales" });
    expect(await note(() => updateFieldAction(T, form({ field_id: choice().id, label: "x" })))).toBe("role");
    fetchTenant.mockResolvedValue({ id: T, role: "owner" });
    for (const bad of [{ label: "x" }, { field_id: choice().id }, { field_id: choice().id, label: "x".repeat(61) }, { field_id: "not-a-field-of-ours", label: "x" }]) expect(await note(() => updateFieldAction(T, form(bad as Record<string, string>))), JSON.stringify(bad)).toBe("invalid");
    expect(await note(() => updateFieldAction(T, form({ field_id: choice().id, label: "ok", choices: Array.from({ length: 21 }, (_, i) => `c${i}`).join("\n") })))).toBe("invalid");
    expect(updateField).not.toHaveBeenCalled();
  });
  it("tells the person why the API said no", async () => {
    updateField.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await note(() => updateFieldAction(T, form({ field_id: choice().id, label: "ok" })))).toBe("mfa");
    updateField.mockRejectedValueOnce(new ApiRequestError(422, "custom_value_invalid", "x"));
    expect(await note(() => updateFieldAction(T, form({ field_id: choice().id, label: "ok" })))).toBe("invalid");
    updateField.mockRejectedValueOnce(new ApiAuthError("x"));
    expect(await note(() => updateFieldAction(T, form({ field_id: choice().id, label: "ok" })))).toBe("/login");
  });
});
