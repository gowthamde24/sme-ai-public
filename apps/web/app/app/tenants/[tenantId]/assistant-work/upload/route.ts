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

/**
 * POST /app/tenants/[tenantId]/assistant-work/upload?name=<file name>: one file of the chat as the request body (its own Content-Type), passed to the API with this person's token
 * (ASSUMED until docs/contracts/assistant-tools.md: `POST /assistant/files`, base64 in JSON like the lead import). Only while ASSISTANT_WORK_SCREENS is `1`, only from this site, only a kind the chat
 * takes and at most 20 MB (the browser checked both before it started; this checks again). The file is not kept here: it goes to the API, which keeps it only as long as the import needs it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (assistantWorkScreens() !== "on" || !isCanonicalUuid(tenantId) || !fromThisSite(request)) return new NextResponse(null, { status: 404, headers: HEADERS });
  const name = (request.nextUrl.searchParams.get("name") ?? "").slice(0, 200);
  if (fileKindOf(name) === null) return NextResponse.json({ ok: false, error: "type" }, { headers: HEADERS });
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
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) return NextResponse.json({ ok: false, error: bytes.byteLength === 0 ? "type" : "size" }, { headers: HEADERS });
  try {
    const file = await uploadAssistantFile(user.accessToken, tenantId, { name, contentType: (request.headers.get("content-type") ?? "application/octet-stream").slice(0, 100), bytes });
    return NextResponse.json({ ok: true, file: { file_id: file.fileId, name: file.name, size_bytes: file.size, kind: file.kind, expires_at: file.expiresAt } }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof ApiAuthError) return new NextResponse(null, { status: 401, headers: HEADERS });
    return NextResponse.json({ ok: false, error: error instanceof ApiRequestError && error.status === 413 ? "size" : error instanceof ApiRequestError && error.status === 403 ? "forbidden" : error instanceof ApiRequestError && error.status === 415 ? "type" : "down" }, { headers: HEADERS });
  }
}
