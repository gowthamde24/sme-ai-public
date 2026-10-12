import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { cancelAccountDeletion, cancelWorkspaceDeletion, executeWorkspaceDeletion, exportLink, getMyExport, listMyDeletions, listMyExports, listWorkspaceDeletions, parseDeletion, parseExport, parseExportLink, requestAccountDeletion, requestExport, requestWorkspaceDeletion } from "./privacy";

const T = "22222222-2222-4222-8222-222222222222";
const E = "33333333-3333-4333-8333-333333333333";
const R = "44444444-4444-4444-8444-444444444444";
const EXPORT = { id: E, scope: "person", tenant_id: null, status: "ready", requested_at: "2026-10-12T10:00:00Z", ready_at: "2026-10-12T10:00:30Z", expires_at: "2026-10-13T10:00:30Z", size_bytes: 12345, sha256: "a".repeat(64), error_code: null, downloads: 0 };
const DELETION = { id: R, kind: "account", tenant_id: null, status: "scheduled", requested_at: "2026-10-12T10:00:00Z", execute_after: "2026-10-26T10:00:00Z", cancelled_at: null, executed_at: null, blocked_reason: null };
beforeEach(() => vi.clearAllMocks());

describe("reading a data export and a deletion", () => {
  it("keeps what the screen shows and nothing else (no hash, no tenant id, no download count)", () => {
    const x = parseExport(EXPORT);
    expect(x).toEqual({ id: E, scope: "person", status: "ready", requested_at: "2026-10-12T10:00:00Z", ready_at: "2026-10-12T10:00:30Z", expires_at: "2026-10-13T10:00:30Z", size_bytes: 12345, error_code: null });
    expect(parseDeletion(DELETION)).toEqual({ id: R, kind: "account", status: "scheduled", requested_at: "2026-10-12T10:00:00Z", execute_after: "2026-10-26T10:00:00Z", cancelled_at: null, executed_at: null, blocked_reason: null });
  });
  it.each([
    ["a status we do not know", { ...EXPORT, status: "done" }],
    ["a scope we do not know", { ...EXPORT, scope: "everyone" }],
    ["an id that is not a uuid", { ...EXPORT, id: "x" }],
    ["a time that is not a time", { ...EXPORT, requested_at: "soon" }],
    ["an error word with spaces", { ...EXPORT, error_code: "a b" }],
  ])("%s is a contract error", (_n, json) => {
    expect(() => parseExport(json)).toThrow(ApiContractError);
  });
  it("a deletion with an unknown status or kind is a contract error", () => {
    expect(() => parseDeletion({ ...DELETION, status: "done" })).toThrow(ApiContractError);
    expect(() => parseDeletion({ ...DELETION, kind: "team" })).toThrow(ApiContractError);
  });
  it("a signed link must be a plain http(s) address; anything else is refused", () => {
    expect(parseExportLink({ url: "https://files.example.test/object/sign/exp-1/a.zip?token=abc", link_valid_seconds: 300, file_expires_at: null, size_bytes: 5, sha256: "x" }).link_valid_seconds).toBe(300);
    for (const url of ["javascript:alert(1)", "data:text/html,x", "//evil.test/a", "https://a b.test/x"]) expect(() => parseExportLink({ url, link_valid_seconds: 300 })).toThrow(ApiContractError);
  });
});

describe("asking the API", () => {
  it("lists and reads my exports", async () => {
    apiRequest.mockResolvedValueOnce({ exports: [EXPORT] });
    expect((await listMyExports("tok"))[0].id).toBe(E);
    expect(apiRequest).toHaveBeenLastCalledWith("/v1/me/data-exports", "tok");
    apiRequest.mockResolvedValueOnce({ export: EXPORT });
    expect((await getMyExport("tok", E)).status).toBe("ready");
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/me/data-exports/${E}`, "tok");
  });
  it("asks for my data with the id the screen made, and for the workspace's through the workspace path", async () => {
    apiRequest.mockResolvedValue({ export: EXPORT });
    await requestExport("tok", E, null);
    expect(apiRequest).toHaveBeenLastCalledWith("/v1/me/data-exports", "tok", { method: "POST", body: JSON.stringify({ export_id: E }) });
    await requestExport("tok", E, T);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/data-exports`, "tok", { method: "POST", body: JSON.stringify({ export_id: E }) });
  });
  it("asks for a link with a POST and reads the address", async () => {
    apiRequest.mockResolvedValue({ url: "https://files.example.test/x?token=1", link_valid_seconds: 300, file_expires_at: null, size_bytes: 3 });
    expect((await exportLink("tok", E)).url).toContain("files.example.test");
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/me/data-exports/${E}/link`, "tok", { method: "POST" });
  });
  it("deletes an account with the typed e-mail, and a workspace with the typed name; both can be cancelled", async () => {
    apiRequest.mockResolvedValue({ deletion: DELETION });
    await requestAccountDeletion("tok", R, "me@example.test");
    expect(apiRequest).toHaveBeenLastCalledWith("/v1/me/deletion-requests", "tok", { method: "POST", body: JSON.stringify({ request_id: R, confirm_email: "me@example.test" }) });
    await cancelAccountDeletion("tok", R);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/me/deletion-requests/${R}/cancel`, "tok", { method: "POST" });
    await requestWorkspaceDeletion("tok", T, R, "Acme Silks");
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/deletion-requests`, "tok", { method: "POST", body: JSON.stringify({ request_id: R, confirm_name: "Acme Silks" }) });
    await cancelWorkspaceDeletion("tok", T, R);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/deletion-requests/${R}/cancel`, "tok", { method: "POST" });
    await executeWorkspaceDeletion("tok", T, R);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/deletion-requests/${R}/execute`, "tok", { method: "POST" });
  });
  it("lists the deletions of the person and of the workspace", async () => {
    apiRequest.mockResolvedValue({ deletions: [DELETION] });
    expect((await listMyDeletions("tok"))[0].status).toBe("scheduled");
    expect(apiRequest).toHaveBeenLastCalledWith("/v1/me/deletion-requests", "tok");
    await listWorkspaceDeletions("tok", T);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/deletion-requests`, "tok");
  });
  it("refuses an id that is not a uuid before asking anything", async () => {
    await expect(requestExport("tok", "x", null)).rejects.toThrow(ApiContractError);
    await expect(cancelWorkspaceDeletion("tok", "bad", R)).rejects.toThrow(ApiContractError);
    await expect(executeWorkspaceDeletion("tok", T, "../x")).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
