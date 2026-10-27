import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "owner", flag: "mock", revalidate: vi.fn(), k: { addPaste: vi.fn(), addFile: vi.fn(), draft: vi.fn(), addManual: vi.fn(), edit: vi.fn(), decide: vi.fn(), discard: vi.fn() }, pb: { readPlaybook: vi.fn(), savePlaybook: vi.fn(), resetToTemplate: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "tok-1" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: async () => { if (h.role === "throw") throw new (await orig<typeof import("@/lib/api/client")>()).ApiAuthError("x"); return { role: h.role }; } }));
vi.mock("@/lib/packs/read", () => ({ readPackCached: async () => ({ packId: "gym" }) }));
vi.mock("@/lib/screens/flag", async (orig) => ({ ...(await orig<typeof import("@/lib/screens/flag")>()), leadsScreens: () => h.flag }));
vi.mock("@/lib/lead-desk/knowledge-source", () => h.k);
vi.mock("@/lib/lead-desk/playbook-source", () => h.pb);

import { addFactAction, addFileAction, addPasteAction, decideFactAction, discardSourceAction, draftFactsAction, editFactAction, resetPlaybookAction, savePlaybookAction } from "./lead-setup-actions";

const T = "22222222-2222-4222-8222-222222222222";
const S = "55555555-5555-4555-8555-555555555555";
const F = "66666666-6666-4666-8666-666666666666";
const NA = { ok: false, error: "not_available" };

beforeEach(() => {
  vi.clearAllMocks();
  h.role = "owner";
  h.flag = "mock";
  for (const f of [...Object.values(h.k), ...Object.values(h.pb)]) f.mockResolvedValue({ ok: true, value: "x" });
  h.pb.readPlaybook.mockResolvedValue({ saved: false });
});

describe("the Lead Desk setup actions (night 4, part A2)", () => {
  it("the knowledge base is managed by the Owner and Admin; Sales and Viewer get nothing", async () => {
    for (const role of ["owner", "admin"]) {
      h.role = role;
      expect((await addPasteAction(T, { sourceId: S, title: "t", text: "some text" })).ok).toBe(true);
    }
    for (const role of ["sales", "viewer"]) {
      h.role = role;
      expect(await addPasteAction(T, { sourceId: S, title: "t", text: "x" })).toEqual(NA);
      expect(await decideFactAction(T, F, "approve")).toEqual(NA);
      expect(await draftFactsAction(T, S)).toEqual(NA);
    }
    expect(h.k.addPaste).toHaveBeenCalledTimes(2);
    expect(h.k.decide).not.toHaveBeenCalled();
  });
  it("everything is refused while the flag is off, for a bad workspace and for ids that are not ids", async () => {
    h.flag = "off";
    expect(await addPasteAction(T, { sourceId: S, title: "t", text: "x" })).toEqual(NA);
    h.flag = "mock";
    expect(await addPasteAction("nope", { sourceId: S, title: "t", text: "x" })).toEqual(NA);
    expect(await addPasteAction(T, { sourceId: "x", title: "t", text: "x" })).toEqual({ ok: false, error: "invalid" });
    expect(await decideFactAction(T, "x", "approve")).toEqual({ ok: false, error: "invalid" });
    expect(await decideFactAction(T, F, "maybe" as never)).toEqual({ ok: false, error: "invalid" });
    expect(await discardSourceAction(T, "x")).toEqual({ ok: false, error: "invalid" });
    expect(await addFactAction(T, { factId: F, kind: "secret" as never, text: "abc def" })).toEqual({ ok: false, error: "invalid" });
    expect(await editFactAction(T, F, { text: "abc def", kind: "secret" as never })).toEqual({ ok: false, error: "invalid" });
    expect(h.k.addPaste).not.toHaveBeenCalled();
    expect(h.k.decide).not.toHaveBeenCalled();
  });
  it("a file is read by its type: PDF, Word and plain text pass with their right content type, anything else is 'unsupported'", async () => {
    await addFileAction(T, { sourceId: S, title: "b", filename: "Brochure.PDF", contentType: "whatever", contentBase64: "QUJD" });
    expect(h.k.addFile).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ contentType: "application/pdf" }));
    expect(await addFileAction(T, { sourceId: S, title: "b", filename: "photo.jpg", contentType: "image/jpeg", contentBase64: "QUJD" })).toEqual({ ok: false, error: "unsupported" });
    expect(await addFileAction(T, { sourceId: S, title: "b", filename: "a.txt", contentType: "text/plain", contentBase64: "<script>" })).toEqual({ ok: false, error: "invalid" });
  });
  it("a price goes to the source, which asks the second factor: a refusal is passed on and nothing is refreshed", async () => {
    h.k.decide.mockResolvedValueOnce({ ok: false, error: "mfa" });
    expect(await decideFactAction(T, F, "approve")).toEqual({ ok: false, error: "mfa" });
    expect(h.revalidate).not.toHaveBeenCalled();
    expect((await decideFactAction(T, F, "reject")).ok).toBe(true);
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/lead-setup`);
  });
  it("the playbook is the Owner's alone, read fresh before it is saved", async () => {
    expect((await savePlaybookAction(T, { goalAsk: "x", questions: [] })).ok).toBe(true);
    expect(h.pb.readPlaybook).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T }), "gym");
    expect((await resetPlaybookAction(T)).ok).toBe(true);
    for (const role of ["admin", "sales", "viewer"]) {
      h.role = role;
      expect(await savePlaybookAction(T, {})).toEqual({ ok: false, error: "not_available" });
      expect(await resetPlaybookAction(T)).toEqual({ ok: false, error: "not_available" });
    }
    h.role = "owner";
    h.pb.readPlaybook.mockResolvedValueOnce(null);
    expect(await savePlaybookAction(T, {})).toEqual({ ok: false, error: "not_available" });
  });
  it("an expired sign-in goes to the login page", async () => {
    h.role = "throw";
    await expect(addPasteAction(T, { sourceId: S, title: "t", text: "x" })).rejects.toThrow("redirect:/login");
  });
});
