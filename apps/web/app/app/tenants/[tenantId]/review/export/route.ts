import { notFound } from "next/navigation";
import { type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { exportLeadLabels } from "@/lib/api/leads";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const user = await requireUser();
  const { tenantId } = await params;

  if (!isCanonicalUuid(tenantId)) notFound();

  // Role check: Only Owner and Admin can export
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) return new Response("Unauthorized", { status: 401 });
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return new Response("Workspace unavailable", { status: 503 });
  }

  if (!["owner", "admin"].includes(tenant.role)) {
    return new Response("Forbidden: only owners and admins may export data.", { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") === "json" ? "json" : "csv";

  try {
    const exportResult = await exportLeadLabels(user.accessToken, tenantId, format);
    const filename = `lead_labels_${tenant.slug || tenantId}.${format}`;

    return new Response(exportResult.content, {
      status: 200,
      headers: {
        "Content-Type": exportResult.contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Export-Sha256": exportResult.sha256,
        "X-Export-Rows": String(exportResult.rowCount),
      },
    });
  } catch (error) {
    if (error instanceof ApiAuthError) return new Response("Unauthorized", { status: 401 });
    if (error instanceof ApiRequestError) {
      return new Response(error.message, { status: error.status });
    }
    return new Response("Export failed", { status: 500 });
  }
}
