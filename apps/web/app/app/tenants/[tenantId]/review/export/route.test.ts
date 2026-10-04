import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError } from "@/lib/api/client";
import { isNotFound, notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const exportLeadLabels = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
  notFound: () => notFoundMock(),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  fetchTenant: (...args: unknown[]) => fetchTenant(...args),
}));
vi.mock("@/lib/api/leads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/leads")>()),
  exportLeadLabels: (...args: unknown[]) => exportLeadLabels(...args),
}));

import { GET } from "./route";

const TENANT = "22222222-2222-2222-2222-222222222222";

function request(url: string): NextRequest {
  return new NextRequest(url);
}

describe("GET /app/tenants/[tenantId]/review/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok" });
    fetchTenant.mockResolvedValue({
      id: TENANT,
      name: "Acme Silks",
      slug: "acme-silks",
      role: "owner",
    });
    exportLeadLabels.mockResolvedValue({
      content: "lead_id,company_name,label\n1,Acme,good\n",
      sha256: "sha256-hash",
      rowCount: 1,
      contentType: "text/csv; charset=utf-8",
    });
  });

  it("exports CSV for an owner role", async () => {
    const req = request(`http://localhost/app/tenants/${TENANT}/review/export?format=csv`);
    const res = await GET(req, { params: Promise.resolve({ tenantId: TENANT }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain('filename="lead_labels_acme-silks.csv"');
    expect(res.headers.get("X-Export-Sha256")).toBe("sha256-hash");
    expect(res.headers.get("X-Export-Rows")).toBe("1");
    expect(await res.text()).toContain("lead_id,company_name,label");

    expect(exportLeadLabels).toHaveBeenCalledWith("tok", TENANT, "csv");
  });

  it("exports JSON for an admin role", async () => {
    fetchTenant.mockResolvedValue({
      id: TENANT,
      name: "Acme Silks",
      slug: "acme-silks",
      role: "admin",
    });
    exportLeadLabels.mockResolvedValue({
      content: '[{"lead_id": 1}]',
      sha256: "json-hash",
      rowCount: 1,
      contentType: "application/json; charset=utf-8",
    });

    const req = request(`http://localhost/app/tenants/${TENANT}/review/export?format=json`);
    const res = await GET(req, { params: Promise.resolve({ tenantId: TENANT }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain('filename="lead_labels_acme-silks.json"');
    expect(exportLeadLabels).toHaveBeenCalledWith("tok", TENANT, "json");
  });

  it("refuses export with 403 for sales role", async () => {
    fetchTenant.mockResolvedValue({
      id: TENANT,
      name: "Acme Silks",
      slug: "acme-silks",
      role: "sales",
    });

    const req = request(`http://localhost/app/tenants/${TENANT}/review/export?format=csv`);
    const res = await GET(req, { params: Promise.resolve({ tenantId: TENANT }) });

    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/Forbidden/i);
    expect(exportLeadLabels).not.toHaveBeenCalled();
  });

  it("refuses export with 403 for viewer role", async () => {
    fetchTenant.mockResolvedValue({
      id: TENANT,
      name: "Acme Silks",
      slug: "acme-silks",
      role: "viewer",
    });

    const req = request(`http://localhost/app/tenants/${TENANT}/review/export?format=csv`);
    const res = await GET(req, { params: Promise.resolve({ tenantId: TENANT }) });

    expect(res.status).toBe(403);
    expect(exportLeadLabels).not.toHaveBeenCalled();
  });

  it("triggers notFound on invalid tenantId", async () => {
    const req = request(`http://localhost/app/tenants/invalid-id/review/export`);
    const found = await isNotFound(() =>
      GET(req, { params: Promise.resolve({ tenantId: "invalid-id" }) }),
    );
    expect(found).toBe(true);
  });

  it("returns 401 when session is rejected", async () => {
    fetchTenant.mockRejectedValue(new ApiAuthError("expired"));
    const req = request(`http://localhost/app/tenants/${TENANT}/review/export`);
    const res = await GET(req, { params: Promise.resolve({ tenantId: TENANT }) });
    expect(res.status).toBe(401);
  });
});
