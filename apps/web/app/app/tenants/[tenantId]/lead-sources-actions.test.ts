import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tenant: vi.fn(), revalidate: vi.fn(), mode: "on" as string,
  create: vi.fn(), rotate: vi.fn(), status: vi.fn(), pull: vi.fn(), discard: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }),
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => h.redirect(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "tok-1" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/lead-desk/sources/source", () => ({
  sourcesMode: () => h.mode,
  createSourceStep: (...a: unknown[]) => h.create(...a),
  rotateStep: (...a: unknown[]) => h.rotate(...a),
  statusStep: (...a: unknown[]) => h.status(...a),
  pullStep: (...a: unknown[]) => h.pull(...a),
  discardStep: (...a: unknown[]) => h.discard(...a),
}));

import { ApiAuthError } from "@/lib/api/client";

import { createSourceAction, discardUnparsedAction, pullIndiaMartAction, rotateSourceAction, sourceStatusAction } from "./lead-sources-actions";

const T = "22222222-2222-4222-8222-222222222222";
const ID = "11111111-1111-4111-8111-111111111111";
const body = { source_id: ID, kind: "website_form", label: "Website", portal: null, consent: null, cost_per_lead_paise: null };

beforeEach(() => {
  vi.clearAllMocks();
  h.mode = "on";
  h.tenant.mockResolvedValue({ role: "owner" });
  for (const f of [h.create, h.rotate, h.status, h.pull, h.discard]) f.mockResolvedValue({ ok: true, data: { id: ID } });
});

describe("the lead sources writes (night 4): Owner and Admin only", () => {
  it("the Owner and the Admin create, rotate, pause, pull and discard with their own token, and the page is refreshed", async () => {
    for (const role of ["owner", "admin"]) {
      h.tenant.mockResolvedValue({ role });
      expect(await createSourceAction(T, body)).toMatchObject({ ok: true });
      expect(await rotateSourceAction(T, ID)).toMatchObject({ ok: true });
      expect(await sourceStatusAction(T, ID, "pause")).toMatchObject({ ok: true });
      expect(await pullIndiaMartAction(T)).toMatchObject({ ok: true });
      expect(await discardUnparsedAction(T, ID)).toMatchObject({ ok: true });
    }
    expect(h.create).toHaveBeenCalledWith({ token: "tok-1", tenantId: T }, expect.objectContaining({ kind: "website_form", label: "Website" }));
    expect(h.status).toHaveBeenCalledWith({ token: "tok-1", tenantId: T }, ID, "pause");
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/lead-sources`);
  });
  it("Sales, Viewer, a stranger's workspace and a bad id reach nothing", async () => {
    for (const role of ["sales", "viewer"]) {
      h.tenant.mockResolvedValue({ role });
      expect(await createSourceAction(T, body)).toEqual({ ok: false, error: "not_available" });
      expect(await rotateSourceAction(T, ID)).toEqual({ ok: false, error: "not_available" });
      expect(await sourceStatusAction(T, ID, "resume")).toEqual({ ok: false, error: "not_available" });
      expect(await pullIndiaMartAction(T)).toEqual({ ok: false, error: "not_available" });
      expect(await discardUnparsedAction(T, ID)).toEqual({ ok: false, error: "not_available" });
    }
    h.tenant.mockRejectedValueOnce(new Error("404"));
    expect(await createSourceAction(T, body)).toEqual({ ok: false, error: "not_available" });
    expect(await createSourceAction("x", body)).toEqual({ ok: false, error: "not_available" });
    for (const f of [h.create, h.rotate, h.status, h.pull, h.discard]) expect(f).not.toHaveBeenCalled();
  });
  it("the flag off answers 'not available'", async () => {
    h.mode = "off";
    expect(await createSourceAction(T, body)).toEqual({ ok: false, error: "not_available" });
    expect(await pullIndiaMartAction(T)).toEqual({ ok: false, error: "not_available" });
    expect(h.create).not.toHaveBeenCalled();
  });
  it("bad input is refused before anything is called: kind, label, portal, consent, cost, ids", async () => {
    const bads: unknown[] = [
      { ...body, kind: "fax" }, { ...body, label: "" }, { ...body, label: "x".repeat(81) }, { ...body, portal: "justdial" }, { ...body, kind: "email_forward", portal: "olx" },
      { ...body, consent: { confirmed: true, list_name: "", purpose: "p", basis: "explicit_consent", how_collected: "h" } }, { ...body, cost_per_lead_paise: -5 }, { ...body, source_id: "nope" }, null, "x",
    ];
    for (const b of bads) expect(await createSourceAction(T, b), JSON.stringify(b)).toEqual({ ok: false, error: "invalid" });
    expect(await createSourceAction(T, { ...body, kind: "email_forward", portal: "justdial", consent: { confirmed: true, list_name: "L", purpose: "P", basis: "contractual", how_collected: "H" }, cost_per_lead_paise: 1500 })).toMatchObject({ ok: true });
    expect(await rotateSourceAction(T, "nope")).toEqual({ ok: false, error: "invalid" });
    expect(await sourceStatusAction(T, ID, "delete" as never)).toEqual({ ok: false, error: "invalid" });
    expect(await discardUnparsedAction(T, "nope")).toEqual({ ok: false, error: "invalid" });
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.rotate).not.toHaveBeenCalled();
  });
  it("the secret travels only in the answer: it is not stored, and a refusal refreshes nothing", async () => {
    h.create.mockResolvedValueOnce({ ok: true, data: { id: ID, secret: { shown_once: true, url: "https://api.example.test/v1/lead-intake/TOKEN" } } });
    const out = await createSourceAction(T, body);
    expect(out.ok && out.data.secret?.url).toContain("TOKEN");
    expect(JSON.stringify(h.revalidate.mock.calls)).not.toContain("TOKEN");
    h.rotate.mockResolvedValueOnce({ ok: false, error: "mfa" });
    h.revalidate.mockClear();
    expect(await rotateSourceAction(T, ID)).toEqual({ ok: false, error: "mfa" });
    expect(h.revalidate).not.toHaveBeenCalled();
  });
  it("an expired sign-in goes to the login page", async () => {
    h.tenant.mockRejectedValueOnce(new ApiAuthError());
    await expect(pullIndiaMartAction(T)).rejects.toThrow("redirect:/login");
    h.rotate.mockRejectedValueOnce(new ApiAuthError());
    await expect(rotateSourceAction(T, ID)).rejects.toThrow("redirect:/login");
  });
});
