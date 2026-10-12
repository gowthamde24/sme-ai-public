import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { acceptInvitation, changeRole, createInvitation, getTeam, listInvitations, parseNewInvitation, parseTeam, removeMember, revokeInvitation } from "./team";

const T = "22222222-2222-4222-8222-222222222222";
const U = "33333333-3333-4333-8333-333333333333";
const I = "44444444-4444-4444-8444-444444444444";
const INV = { id: I, role: "sales", label: "for the cutter", status: "pending", created_at: "2026-10-12T10:00:00Z", expires_at: "2026-10-19T10:00:00Z", accepted_at: null, revoked_at: null };
beforeEach(() => vi.clearAllMocks());

describe("the team", () => {
  it("reads the members (owners first as the API sends them) and the count of waiting invitations", async () => {
    apiRequest.mockResolvedValue({ members: [{ user_id: U, display_name: "Asha", role: "owner", joined_at: "2026-10-01T10:00:00Z", is_you: true }, { user_id: I, display_name: null, role: "viewer", joined_at: null, is_you: false }], pending_invitations: 2 });
    const t = await getTeam("tok", T);
    expect(t.members.map((m) => m.role)).toEqual(["owner", "viewer"]);
    expect(t.members[0].is_you).toBe(true);
    expect(t.pending_invitations).toBe(2);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/team`, "tok");
  });
  it("a salesperson's team has no count of invitations", () => {
    expect(parseTeam({ members: [], pending_invitations: null }).pending_invitations).toBeNull();
  });
  it.each([["a role we do not know", { members: [{ user_id: U, display_name: "x", role: "boss", joined_at: null, is_you: false }], pending_invitations: 0 }], ["a user id that is not a uuid", { members: [{ user_id: "x", display_name: "x", role: "sales", joined_at: null, is_you: false }], pending_invitations: 0 }]])("%s is a contract error", (_n, json) => {
    expect(() => parseTeam(json)).toThrow(ApiContractError);
  });
});

describe("invitations", () => {
  it("makes one with an id the screen made, and gives back its code once", async () => {
    apiRequest.mockResolvedValue({ invitation: { ...INV, code: "7QX2K-M9R4D-0A1B2-C3D4E", replayed: false } });
    const r = await createInvitation("tok", T, { invitationId: I, role: "sales", days: 7, label: " for the cutter " });
    expect(r.code).toBe("7QX2K-M9R4D-0A1B2-C3D4E");
    expect(r.replayed).toBe(false);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/invitations`, "tok", { method: "POST", body: JSON.stringify({ invitation_id: I, role: "sales", days: 7, label: "for the cutter" }) });
  });
  it("a retry of the same id has no code any more", () => {
    const r = parseNewInvitation({ invitation: { ...INV, code: null, replayed: true } });
    expect(r.code).toBeNull();
    expect(r.replayed).toBe(true);
  });
  it("never offers to invite an Owner, and refuses days outside 1 to 30", async () => {
    await expect(createInvitation("tok", T, { invitationId: I, role: "owner", days: 7 })).rejects.toThrow(ApiContractError);
    await expect(createInvitation("tok", T, { invitationId: I, role: "sales", days: 31 })).rejects.toThrow(ApiContractError);
    await expect(createInvitation("tok", T, { invitationId: I, role: "sales", days: 0 })).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("a code with odd characters is refused (it would be put in a link)", () => {
    expect(() => parseNewInvitation({ invitation: { ...INV, code: "<script>alert(1)</script>", replayed: false } })).toThrow(ApiContractError);
  });
  it("lists them without a code, and revokes one", async () => {
    apiRequest.mockResolvedValueOnce({ invitations: [{ ...INV, created_by_name: "Asha" }] });
    const l = await listInvitations("tok", T);
    expect(l[0]).toMatchObject({ id: I, created_by_name: "Asha" });
    expect(JSON.stringify(l)).not.toMatch(/code/);
    apiRequest.mockResolvedValueOnce({ invitation: { ...INV, status: "revoked", revoked_at: "2026-10-12T11:00:00Z" } });
    expect((await revokeInvitation("tok", T, I)).status).toBe("revoked");
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/invitations/${I}/revoke`, "tok", { method: "POST" });
  });
});

describe("roles, removal and joining", () => {
  it("changes a role to admin, sales or viewer only", async () => {
    apiRequest.mockResolvedValue({ user_id: U, role: "admin", changed: true });
    expect(await changeRole("tok", T, U, "admin")).toEqual({ user_id: U, role: "admin", changed: true });
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/members/${U}/role`, "tok", { method: "POST", body: JSON.stringify({ role: "admin", reason: "role_changed" }) });
    await expect(changeRole("tok", T, U, "owner")).rejects.toThrow(ApiContractError);
  });
  it("removes a person or leaves, with a reason from the list, and reads back the counts", async () => {
    apiRequest.mockResolvedValue({ user_id: U, removed: true, leads_unassigned: 3, opportunities_unassigned: 1, runs_cancelled: 0, invitations_revoked: 0 });
    expect(await removeMember("tok", T, U, "left")).toMatchObject({ leads_unassigned: 3, opportunities_unassigned: 1 });
    await expect(removeMember("tok", T, U, "because")).rejects.toThrow(ApiContractError);
  });
  it("accepts a code as typed and reads where it led", async () => {
    apiRequest.mockResolvedValue({ status: "joined", tenant_id: T, tenant_name: "Acme Silks", role: "sales" });
    expect(await acceptInvitation("tok", " 7qx2k m9r4d ")).toEqual({ tenant_id: T, tenant_name: "Acme Silks", role: "sales" });
    expect(apiRequest).toHaveBeenCalledWith("/v1/invitations/accept", "tok", { method: "POST", body: JSON.stringify({ code: " 7qx2k m9r4d " }) });
  });
});
