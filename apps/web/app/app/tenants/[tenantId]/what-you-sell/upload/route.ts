import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { uploadAssistantFile } from "@/lib/api/assistant-work";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fileKindOf, MAX_FILE_BYTES } from "@/lib/assistant-work/types";
import { requireUser } from "@/lib/auth/session";
import { jobsScreens } from "@/lib/screens/flag";

import { fromThisSite } from "../../ask/ask-response";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** The kinds the reading call takes (C1 contract 1.1 part 1, answer 8): photos, a PDF, a sheet. A Word file, a card or plain text is not one of them. */
const READABLE = new Set(["image", "pdf", "sheet"]);

/** The API's refusal of a file (413 `file_too_large`, 415 `file_type`, 422 `file_empty`, 403) as the closed word the sheet has a sentence for (`jobs.sell.file.<word>`). */
function refusal(error: unknown): "size" | "type" | "empty" | "forbidden" | "down" {
  if (!(error instanceof ApiRequestError)) return "down";
  if (error.code === "file_too_large" || error.status === 413) return "size";
  if (error.code === "file_type" || error.status === 415) return "type";
  if (error.code === "file_empty") return "empty";
  return error.status === 403 ? "forbidden" : "down";
}

/**
 * POST /app/tenants/[tenantId]/what-you-sell/upload?name=<file name>: the photo or sheet of "Take photos" / "Import a sheet" as the request body (its own Content-Type), dropped through the assistant's file route
 * (`POST /assistant/files`, kept 24 h, readable only by this person) and answered as `{ok: true, file_id}`; the sheet then asks the reading call with that id. Only while JOBS is on and the screens are real (not mock), only from this site,
 * only for the Owner and an Admin, only a photo, PDF or sheet, at most 15 MB (the browser checked first; this checks again). The file is not kept here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (jobsScreens() !== "on" || !isCanonicalUuid(tenantId) || !fromThisSite(request)) return new NextResponse(null, { status: 404, headers: HEADERS });
  const name = (request.nextUrl.searchParams.get("name") ?? "").slice(0, 200);
  const contentType = (request.headers.get("content-type") ?? "application/octet-stream").slice(0, 100);
  const kind = fileKindOf(name, contentType);
  if (kind === null || !READABLE.has(kind)) return NextResponse.json({ ok: false, error: "type" }, { headers: HEADERS });
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
    if (role !== "owner" && role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { headers: HEADERS });
  } catch (error) {
    return new NextResponse(null, { status: error instanceof ApiAuthError ? 401 : 404, headers: HEADERS });
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) return NextResponse.json({ ok: false, error: bytes.byteLength === 0 ? "empty" : "size" }, { headers: HEADERS });
  try {
    const file = await uploadAssistantFile(user.accessToken, tenantId, { name, contentType, bytes });
    return NextResponse.json({ ok: true, file_id: file.fileId }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof ApiAuthError) return new NextResponse(null, { status: 401, headers: HEADERS });
    return NextResponse.json({ ok: false, error: refusal(error) }, { headers: HEADERS });
  }
}
