import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const createLeadLabel = vi.fn();
const importLeads = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/leads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/leads")>()),
  createLeadLabel: (...args: unknown[]) => createLeadLabel(...args),
  importLeads: (...args: unknown[]) => importLeads(...args),
}));

import { importLeadsAction, labelLeadAction } from "./actions";

const TENANT = "22222222-2222-2222-2222-222222222222";
const LEAD_ID = "33333333-3333-3333-3333-333333333333";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("labelLeadAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok" });
    createLeadLabel.mockResolvedValue({
      id: "label-1",
      label: "good",
      reason_code: null,
    });
  });

  it("labels a lead as good without reason code and revalidates review page", async () => {
    const res = await labelLeadAction(
      TENANT,
      LEAD_ID,
      {},
      form({ label: "good" }),
    );
    expect(res).toEqual({ ok: true, message: "Lead marked as good." });
    expect(createLeadLabel).toHaveBeenCalledWith("tok", TENANT, LEAD_ID, {
      label: "good",
      reason_code: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      `/app/tenants/${TENANT}/review`,
    );
  });

  it("labels a lead as maybe without reason code", async () => {
    const res = await labelLeadAction(
      TENANT,
      LEAD_ID,
      {},
      form({ label: "maybe" }),
    );
    expect(res.ok).toBe(true);
    expect(createLeadLabel).toHaveBeenCalledWith("tok", TENANT, LEAD_ID, {
      label: "maybe",
      reason_code: null,
    });
  });

  it("labels a lead as bad with a valid reason code", async () => {
    const res = await labelLeadAction(
      TENANT,
      LEAD_ID,
      {},
      form({ label: "bad", reason_code: "not_our_market" }),
    );
    expect(res).toEqual({ ok: true, message: "Lead marked as bad." });
    expect(createLeadLabel).toHaveBeenCalledWith("tok", TENANT, LEAD_ID, {
      label: "bad",
      reason_code: "not_our_market",
    });
  });

  it("rejects bad label if reason code is missing", async () => {
    const res = await labelLeadAction(
      TENANT,
      LEAD_ID,
      {},
      form({ label: "bad" }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Select a reason code/i);
    expect(createLeadLabel).not.toHaveBeenCalled();
  });

  it("rejects bad label if reason code is invalid", async () => {
    const res = await labelLeadAction(
      TENANT,
      LEAD_ID,
      {},
      form({ label: "bad", reason_code: "fake_reason" }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Select a reason code/i);
    expect(createLeadLabel).not.toHaveBeenCalled();
  });

  it("rejects invalid label value", async () => {
    const res = await labelLeadAction(
      TENANT,
      LEAD_ID,
      {},
      form({ label: "unknown" }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/valid label/i);
  });

  it("validates UUIDs for tenant and lead", async () => {
    const res = await labelLeadAction(
      "bad-tenant",
      LEAD_ID,
      {},
      form({ label: "good" }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Invalid workspace or lead reference/i);
  });

  it("redirects on ApiAuthError", async () => {
    createLeadLabel.mockRejectedValue(new ApiAuthError("expired"));
    const target = await redirectTarget(() =>
      labelLeadAction(TENANT, LEAD_ID, {}, form({ label: "good" })),
    );
    expect(target).toBe("/login");
  });

  it("surfaces 403 role error as user-friendly message", async () => {
    createLeadLabel.mockRejectedValue(
      new ApiRequestError(403, "forbidden", "Viewer cannot label"),
    );
    const res = await labelLeadAction(
      TENANT,
      LEAD_ID,
      {},
      form({ label: "good" }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Your role cannot label leads.");
  });
});

describe("importLeadsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok" });
    importLeads.mockResolvedValue({
      batch_id: "batch-1",
      replayed: false,
      dry_run: false,
      counts: { rows: 1, created: 1, skipped_duplicate: 0 },
      rows: [],
    });
  });

  it("imports valid rows in dry_run mode without revalidating paths", async () => {
    const rowsJson = JSON.stringify([
      { company_name: "Silk Saree Hub", city: "Bengaluru", country: "IN" },
    ]);
    const res = await importLeadsAction(
      TENANT,
      {},
      form({ raw_json: rowsJson, dry_run: "true", batch_label: "test run" }),
    );
    expect(res.ok).toBe(true);
    expect(importLeads).toHaveBeenCalledWith(
      "tok",
      TENANT,
      expect.objectContaining({
        label: "test run",
        rows: [
          expect.objectContaining({
            company_name: "Silk Saree Hub",
            city: "Bengaluru",
            country: "IN",
          }),
        ],
      }),
      true, // isDryRun
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("imports and commits valid rows, revalidating review and workspace paths", async () => {
    const rowsJson = JSON.stringify([
      { company_name: "Silk Saree Hub", contact_email: "test@example.com" },
    ]);
    const res = await importLeadsAction(
      TENANT,
      {},
      form({ raw_json: rowsJson, dry_run: "false" }),
    );
    expect(res.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/app/tenants/${TENANT}/review`,
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}`);
  });

  it("rejects invalid JSON syntax", async () => {
    const res = await importLeadsAction(
      TENANT,
      {},
      form({ raw_json: "not valid json" }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Invalid JSON format/i);
    expect(importLeads).not.toHaveBeenCalled();
  });

  it("rejects non-array or empty array JSON", async () => {
    const resEmpty = await importLeadsAction(
      TENANT,
      {},
      form({ raw_json: "[]" }),
    );
    expect(resEmpty.ok).toBe(false);
    expect(resEmpty.error).toMatch(/non-empty array/i);

    const resObj = await importLeadsAction(
      TENANT,
      {},
      form({ raw_json: '{"company_name": "x"}' }),
    );
    expect(resObj.ok).toBe(false);
    expect(resObj.error).toMatch(/non-empty array/i);
  });

  it("rejects rows missing company_name", async () => {
    const res = await importLeadsAction(
      TENANT,
      {},
      form({ raw_json: JSON.stringify([{ city: "Bengaluru" }]) }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Row 1 is missing a company_name/i);
  });

  it("rejects batch exceeding 500 rows", async () => {
    const huge = Array.from({ length: 501 }, (_, i) => ({
      company_name: `Co ${i}`,
    }));
    const res = await importLeadsAction(
      TENANT,
      {},
      form({ raw_json: JSON.stringify(huge) }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Batch size cannot exceed 500 rows/i);
  });

  it("redirects on ApiAuthError during import", async () => {
    importLeads.mockRejectedValue(new ApiAuthError("expired"));
    const target = await redirectTarget(() =>
      importLeadsAction(
        TENANT,
        {},
        form({ raw_json: JSON.stringify([{ company_name: "Test" }]) }),
      ),
    );
    expect(target).toBe("/login");
  });
});
