import type { NextRequest } from "next/server";

import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { apiDownloadRequest } from "@/lib/api/client";
import { EXPORT_FORMATS } from "@/lib/api/data";
import { failureOf } from "@/lib/api/failure";

import { failureResponse, guard, NO_STORE } from "../route-kit";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_TYPE = /^[a-z]+\/[a-z0-9.+-]+(;\s*charset=[a-z0-9-]+)?$/i;

/**
 * POST /app/tenants/[tenantId]/data/export (job CC): the accounting file for a date range (Tally files, a Vyapar workbook, CSV or Excel), made by the API and passed to the browser as a download. Owner and Admin with the second factor
 * (the API checks both). The body is {export_id, format, from_date, to_date}; the file's bytes are not read, kept or logged here. The counts the API reports travel in X- headers for the screen to show.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const guarded = await guard(request, params);
  if (guarded instanceof Response) return guarded;
  const { user, tenantId } = guarded;
  let body: unknown;
  try {
    body = JSON.parse((await request.text()).slice(0, 2000));
  } catch {
    body = null;
  }
  const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  if (!b || typeof b.export_id !== "string" || !UUID.test(b.export_id) || typeof b.format !== "string" || !(EXPORT_FORMATS as readonly string[]).includes(b.format) || typeof b.from_date !== "string" || !DAY.test(b.from_date) || typeof b.to_date !== "string" || !DAY.test(b.to_date)) {
    return new Response("Bad request", { status: 400, headers: NO_STORE });
  }
  const t = appT(await getLang());
  try {
    const file = await apiDownloadRequest(`/v1/tenants/${tenantId}/exports/accounting`, user.accessToken, { export_id: b.export_id, format: b.format, from_date: b.from_date, to_date: b.to_date });
    const headers: Record<string, string> = { ...NO_STORE, "Content-Type": SAFE_TYPE.test(file.contentType) ? file.contentType : "application/octet-stream", "X-Content-Type-Options": "nosniff" };
    if (file.filename) headers["Content-Disposition"] = `attachment; filename="${file.filename}"`;
    for (const [k, v] of Object.entries(file.headers)) headers[k] = v;
    headers["Access-Control-Expose-Headers"] = "Content-Disposition, X-Export-Sales, X-Export-Payments, X-Content-SHA256";
    return new Response(file.bytes, { status: 200, headers });
  } catch (error) {
    try {
      return failureResponse(failureOf(error, t));
    } catch {
      return new Response("Unauthorized", { status: 401, headers: NO_STORE });
    }
  }
}
