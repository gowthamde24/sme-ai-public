import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { uploadAssistantFile } from "@/lib/api/assistant-work";
import { fileKindOf, MAX_FILE_BYTES } from "@/lib/assistant-work/types";
import { requireUser } from "@/lib/auth/session";
import { assistantWorkScreens } from "@/lib/screens/flag";

import { fromThisSite } from "../../ask/ask-response";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** The API's refusal of a file (the contract: 413 `file_too_large`, 415 `file_type`, 422 `file_empty`, 403 forbidden) as the closed word the chip has a sentence for. */
function refusal(error: unknown): "size" | "type" | "empty" | "forbidden" | "down" {
  if (!(error instanceof ApiRequestError)) return "down";
  if (error.code === "file_too_large" || error.status === 413) return "size";
  if (error.code === "file_type" || error.status === 415) return "type";
  if (error.code === "file_empty") return "empty";
  return error.status === 403 ? "forbidden" : "down";
}

/**
 * POST /app/tenants/[tenantId]/assistant-work/upload?name=<file name>: one file of the chat as the request body (its own Content-Type), passed to the API with this person's token
 * (C1's contract, docs/contracts/assistant-tools.md section 1: `POST /assistant/files`, base64 in JSON like the lead import). Only while ASSISTANT_WORK_SCREENS is `1`, only from this site, only a kind
 * the chat takes and at most 10 MB (the browser checked both before it started; this checks again). The file is not kept here: it goes to the API, which keeps it only as long as the import needs it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (assistantWorkScreens(tenantId) !== "on" || !isCanonicalUuid(tenantId) || !fromThisSite(request)) return new NextResponse(null, { status: 404, headers: HEADERS });
  const name = (request.nextUrl.searchParams.get("name") ?? "").slice(0, 200);
  const contentType = (request.headers.get("content-type") ?? "application/octet-stream").slice(0, 100);
  if (fileKindOf(name, contentType) === null) return NextResponse.json({ ok: false, error: "type" }, { headers: HEADERS });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_FILE_BYTES) return NextResponse.json({ ok: false, error: "size" }, { headers: HEADERS });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse(null, { status: 401, headers: HEADERS });
  }
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role === "viewer") return NextResponse.json({ ok: false, error: "forbidden" }, { headers: HEADERS });
  } catch (error) {
    return new NextResponse(null, { status: error instanceof ApiAuthError ? 401 : 404, headers: HEADERS });
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) return NextResponse.json({ ok: false, error: bytes.byteLength === 0 ? "empty" : "size" }, { headers: HEADERS });
  try {
    const file = await uploadAssistantFile(user.accessToken, tenantId, { name, contentType, bytes });
    return NextResponse.json({ ok: true, file: { file_id: file.fileId, name: file.name, size_bytes: file.size, kind: file.kind, expires_at: file.expiresAt } }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof ApiAuthError) return new NextResponse(null, { status: 401, headers: HEADERS });
    return NextResponse.json({ ok: false, error: refusal(error) }, { headers: HEADERS });
  }
}
