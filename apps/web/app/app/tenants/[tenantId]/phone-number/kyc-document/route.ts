import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { FILE_TYPES, MAX_FILE_BYTES, sendDocument } from "@/lib/phone-kyc/source";
import { kycPerClient, phonePicker } from "@/lib/screens/flag";

import { fromThisSite } from "../../ask/ask-response";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const isBlob = (v: unknown): v is Blob => typeof v === "object" && v !== null && typeof (v as Blob).size === "number" && typeof (v as Blob).arrayBuffer === "function";
const refuse = (status: number, error: string, reason?: string) => NextResponse.json({ ok: false, error, ...(reason ? { reason } : {}) }, { status, headers });

/**
 * POST /app/tenants/[tenantId]/phone-number/kyc-document (KYC_PER_CLIENT with PHONE_PICKER): one document of the business (PAN, Aadhaar file or GST certificate: jpg, png or pdf, up to 10 MB) as multipart `type` + `file`. A file is too big for a server action, so it
 * comes here, only from this site and only for the Owner. It is held in memory for this request, passed to the API (`POST /phone-kyc/business/documents`) and dropped: never stored, never logged, never returned. Answers `{ok, data: status}` or `{ok: false, error, reason}`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (phonePicker() === "off" || kycPerClient() === "off" || !isCanonicalUuid(tenantId)) return new NextResponse(null, { status: 404, headers });
  if (!fromThisSite(request)) return new NextResponse(null, { status: 403, headers });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse(null, { status: 401, headers });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(415, "invalid");
  }
  const file = form.get("file");
  if (!isBlob(file) || file.size === 0) return refuse(422, "refused", "file_unreadable");
  if (file.size > MAX_FILE_BYTES) return refuse(413, "refused", "file_too_big");
  if (!(FILE_TYPES as readonly string[]).includes(file.type)) return refuse(415, "refused", "file_unreadable");
  try {
    if ((await fetchTenant(user.accessToken, tenantId)).role !== "owner") return refuse(403, "forbidden");
    const out = await sendDocument(user.accessToken, tenantId, form.get("type"), file.type, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json(out, { status: out.ok ? 200 : out.error === "invalid" ? 422 : out.error === "forbidden" ? 403 : out.error === "step_up" ? 403 : out.error === "down" ? 503 : 422, headers });
  } catch (error) {
    if (error instanceof ApiAuthError) return new NextResponse(null, { status: 401, headers });
    return refuse(502, "down");
  }
}
